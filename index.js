'use strict';

var PLUGIN_NAME = 'MyBestPro';

var through     = require('through2'),
    gutil       = require('gulp-util'),
    PluginError = gutil.PluginError,
    fs          = require('fs'),
    glob        = require('glob'),
    LZString    = require('lz-string'),
    mime        = require('mime'),
    path        = require('path')
;

/*
* Recursively merge properties of two objects 
*/
var extend = function (object, overload) {
    for (var property in overload) {
        if (overload.hasOwnProperty(property)) {
            try {
                if (overload[property].constructor == Object) {
                    object[property] = extend(
                        object[property],
                        overload[property]
                    );
                } else {
                    object[property] = overload[property];
                }
            } catch(e) {
                object[property] = overload[property];
            }
        }
    }

    return object;
}

var internalize = function (type, data) {
    return through.obj(function (file, enc, callback) {
        var inputString = null,
            result = null,
            outBuffer=null;
        //Empty file and directory not supported
        if (file === null || file.isDirectory()) {
            this.push(file);

            return callback();
        }

        if(file.isBuffer()) {
            inputString = new String(file.contents);
            switch (type) {
                case 'css':
                    result = _internalizeCSS(inputString, data);
                    break;
                case 'js':
                    result = _internalizeJS(inputString, data);
                    break;
                case 'angular-template':
                    result = _internalizeAngularTpl(inputString, data);
                    break;
                case 'resources':
                    result = _internalizeResources(inputString, data);
                    break;
                case 'translations':
                    result = _internalizeTranslations(inputString, data);
                    break;
                default:
                    this.emit(
                        'error',
                        new PluginError(
                            PLUGIN_NAME,
                            'Type must be [css|js|angular-template|resources]'
                        )
                    );
                    callback();
                    return;
                    break;
            }
            outBuffer = new Buffer(result);
            var aFile = new gutil.File();
            aFile.path = file.path;
            aFile.contents = outBuffer;
            callback(null, aFile);
        } else {
            this.emit(
                'error',
                new PluginError(
                    PLUGIN_NAME,
                    'Only Buffer format is supported'
                )
            );
            callback();
        }
    });
}

var compress = function (data) {
    return through.obj(function (file, enc, callback) {
        var inputString = null,
            result = null,
            outBuffer=null;
        //Empty file and directory not supported
        if (file === null || file.isDirectory()) {
            this.push(file);

            return callback();
        }

        if(file.isBuffer()) {
            inputString = new String(file.contents);
            var delimiterHeadStart = '<head>',
                delimiterHeadStop  = '<\/head>',
                delimiterBodyStart = '<body>',
                delimiterBodyStop  = '<\/body>'
            ;

            if (data && data.delimiter) {
                if (data.delimiter.head) {
                    delimiterHeadStart = data.delimiter.head.start ||
                                         delimiterHeadStart;
                    delimiterHeadStop  = data.delimiter.head.stop  ||
                                         delimiterHeadStop;
                }
                if (data.delimiter.body) {
                    delimiterBodyStart = data.delimiter.body.start ||
                                         delimiterBodyStart;
                    delimiterBodyStop  = data.delimiter.body.stop  ||
                                         delimiterBodyStop;
                }
            }

            var parts = {};
            for (var i in data.delimiters) {
                if (data.delimiters.hasOwnProperty(i)) {
                    var delimiter = data.delimiters[i];
                    parts[i] = inputString.replace(
                        new RegExp(
                            '[\\s\\S]*' +
                            delimiter.start +
                            '([\\s\\S]*)' +
                            delimiter.stop +
                            '[\\s\\S]*'
                        , 'g'),
                        '$1'
                    );
                }
            }

            // In two times to be more readable
            var compressed = {};
            for (var i in parts) {
                if (parts.hasOwnProperty(i)) {
                    compressed[i] = LZString.compressToBase64([
                        JSON.stringify(parts[i].split('\n')),
                        '.join(\'\\n\')'
                    ].join(''));
                }
            }
            if (data.data) {
                compressed = extend(compressed, data.data);
            }

            result = JSON.stringify(compressed);

            outBuffer = new Buffer(result);
            var aFile = new gutil.File();
            aFile.path = file.path;
            aFile.contents = outBuffer;
            callback(null, aFile);
        } else {
            this.emit(
                'error',
                new PluginError(
                    PLUGIN_NAME,
                    'Only Buffer format is supported'
                )
            );
            callback();
        }
    });
}

var _internalizeCSS = function (string, data) {
    var source_folder = data.source_folder || '';

    return string.replace(
        /<link.*type="text\/css"[^>]*\/>/g,
        function (match, offset, string) {
            return match.replace(
                /.*href="([^"]+)".*/g,
                function (match, p1, offset, string) {
                    if (!p1.match(/^(http)/g)) {
                        gutil.log(
                            gutil.colors.yellow(
                                '[_internalizeCSS - IT1] - Match ' + p1
                            )
                        );
                        return [
                            '<style type="text/css">',
                            fs.readFileSync(
                                source_folder + p1,
                                'utf8'
                            ),
                            '</style>',
                        ].join('\n');
                    }
                    return match;
                }
            );
        }
    );
}

var _internalizeJS = function (string, data) {
    var source_folder = data.source_folder || '';

    return string.replace(
        /<script.*(src="([^"]+)")[^>]*>/g,
        function (match, p1, p2, offset, string) {
            if (!p2.match(/^(http)/g)) {
                gutil.log(
                    gutil.colors.yellow(
                        '[_internalizeJS - IT1] - Match ' + p2
                    )
                );
                return [
                    match.replace(
                        new RegExp(p1, 'g'), 
                        ''
                    ),
                    fs.readFileSync(
                        source_folder + p2,
                        'utf8'
                    )
                ].join('\n');
            }
            return match;
        }
    );
}

var _internalizeAngularTpl = function (string, data) {
    var source_folder  = data.source_folder || '',
        delimiter      = data.delimiter || '</body>';

    return string.replace(
        delimiter,
        function (match, offset, string) {
            var tpl = '';
            glob.sync(source_folder + 'html/**/*.html').forEach(
                function(filePath) {
                    tpl += [
                        '\n<script ',
                        'type="text/ng-template" ',
                        'id="' + filePath.replace(source_folder, '') + '"',
                        '>\n',
                        fs.readFileSync(filePath, 'utf8'),
                        '</script>',
                    ].join('');
                }
            );
            tpl += '\n' + match;

            return tpl;
        }
    );
}

var _internalizeResources = function (string, data) {
    var source_folder  = data.source_folder || '',
        css_path = data.css_path || '';;

    return string.replace(
        /src="([^"]+)"/g,
        function (match, p1, offset, string) {
            if (
                !p1.match(/^(https?:\/\/|file:\/\/|data:)/g)
                // strict rule for url pattern
                && p1.match(/^[a-zA-Z0-9\.\/_-]{2,}$/g)
            ) {
                // transform to base64
                var file = source_folder + p1;
                gutil.log(
                    gutil.colors.yellow(
                        '[_internalizeResources - IT1] - Match ' + p1
                    )
                );
                return [
                    'src="data:' + mime.lookup(file),
                    ';base64,',
                    new Buffer(fs.readFileSync(
                        file
                    )).toString('base64'),
                    '"'
                ].join('');
            }
            return match;
        }
    ).replace(
        /url\s*\(\s*"?'?([^\)|"|']+)'?"?\s*\)/g,
        function (match, p1, offset, string) {
            if (
                !p1.match(/^(https?:\/\/|file:\/\/|data:)/g)
                // strict rule for url pattern
                && p1.match(/^[a-zA-Z0-9\.\/_-]{2,}$/g)
            ) {
                gutil.log(
                    gutil.colors.yellow(
                        '[_internalizeResources - IT2] - Match ' + p1
                    )
                );
                var file = source_folder + css_path + p1;
                return [
                    'url(data:' + mime.lookup(file),
                    ';base64,',
                    new Buffer(fs.readFileSync(
                        file
                    )).toString('base64'),
                    ')'
                ].join('');
            }
            return match;
        }
    );
}

var _internalizeTranslations = function (string, data) {
    var source_folder  = data.source_folder || '',
        delimiter      = data.delimiter || '//#### ####//';

    return string.replace(
        delimiter,
        function (match, offset, string) {
            var tpl = '//TRANSLATIONS\n$translateProvider';
            glob.sync(source_folder + '/**/*.json').forEach(
                function(filePath) {
                    var locale = path.basename(
                        filePath,
                        path.extname(filePath)
                    );
                    gutil.log(
                        gutil.colors.yellow(
                            '[_internalizeTranslations - IT1] - ' + 
                            'write translation for ' + locale
                        )
                    );
                    tpl += [
                        '.translations(',
                        '\'' + locale + '\', ',
                        fs.readFileSync(filePath, 'utf8'),
                        ')',
                    ].join('');
                }
            );
            tpl += ';\n';

            return tpl;
        }
    );
}


var MyBestPro = {
    internalize: internalize,
    compress: compress
};

module.exports = MyBestPro;
