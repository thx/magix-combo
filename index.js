var mdeps = require('module-deps')
var JSONStream = require('JSONStream')
var Es = require('event-stream')
var fs = require('fs')
var path = require('path')
var dirname = path.dirname
var process = require('process')
var through = require('through2')
var combineTool = require('magix-combine')

var magixViewReg = /(?:mx|data)-view\s*=\s*("[^"]*"|'[^']*'|[^'">\s]*)/g
var cssReg = /Magix\.applyStyle\((?:"[^"]*"|'[^']*'|[^'">\s\n]*)\,?\s*("[^"]*"|'[^']*'|[^'">\s\n]*)\)/g

var seaContents = fs.readFileSync(__dirname + '/sea.js')
var rootBase = process.cwd()

// 配置magix combine
combineTool.config({
  prefix: 'mx',
  tmplFolder: './',
  tmplCommand: /<%[\s\S]+?%>/g,
  loaderType: 'cmd'
})

// 分析以哪些js为入口
var collectResources = function(pageHtml, options) {
  var extra = options.extra
  var results = [],
    match, basename
  while (match = magixViewReg.exec(pageHtml)) {
    basename = match[1].replace(/'|"/g, '')
    results.push({
      id: basename,
      isView: true,
      file: rootBase + '/' + basename + '.js'
    })
  }

  if (extra && extra instanceof Function) {
    var extraJs = extra(options) || []
    for (var i = 0; i < extraJs.length; i++) {
      results.push({
        id: extraJs[i],
        isView: true,
        file: rootBase + '/' + extraJs[i] + '.js'
      })
    }
  }

  var extName = path.extname(options.path)
  var innerJsPath = options.path.replace(rootBase, '').replace(extName, '.js')
  results.push({
    id: innerJsPath,
    isBoot: true,
    file: rootBase + innerJsPath
  })

  return results
}

var analyseDeps = function(needAnalyseResources, callback) {

  var dicsContents = ''
  var dicsArray = []
  var md = mdeps({
    //从当前根目录找
    paths: [process.env.NODE_PATH, rootBase]
  })
  md.pipe(JSONStream.stringify()).pipe(Es.mapSync(function(data) {
    dicsContents += data
    return data
  })).on('end', function() {
    dicsArray = JSON.parse(dicsContents)
    callback(dicsArray)
  })

  needAnalyseResources.forEach(function(resource) {
    md.write(resource)
  })
  md.end()
}

/*分析html页面，生成对应的js*/
var combo = function(options, callback) {
  var pageHtml = options.contents

  var needAnalyseResources = collectResources(pageHtml, options)

  var pageName = path.basename(options.path).split('.')[0]
  var buildDir = path.dirname(options.path)
  var pagePath = buildDir + '/' + pageName
  var innerCssPath = pagePath + '.less'

  analyseDeps(needAnalyseResources, function(dicsArray) {
    var counts = dicsArray.length
    var jsContents = seaContents
    var cssContents = fs.readFileSync(innerCssPath)
    var entryJs = ''

    var handle = function() {
      counts--
      if (counts === 0) {
        fs.writeFileSync(pagePath + '.js', jsContents + entryJs)
        fs.writeFileSync(pagePath + '.less', cssContents)
        if (options.transform) {
          pageHtml = options.transform(pageHtml)
        }
        callback && callback(pageHtml)
      }
    }

    dicsArray.forEach(function(dic, index) {
      //对source进行加工，变成amd里面define的包裹格式
      if (!/define\s*\(\s*['"]\s*[\w\/]+['"]/.test(dic.source) && !dic.isBoot) {

        combineTool.processContent(dic.file, '', dic.source).then(function(source) {
          jsContents += source.replace(cssReg, function(match, css) {
            cssContents += css.replace(/'|"/g, '')
            return ''
          })
          handle()
        })
      } else if (dic.isBoot) {
        entryJs = dic.source // 最后处理，加在文件的最后面
        handle()
      } else {
        jsContents += dic.source
        handle()
      }

    })
  })

}


module.exports = function(config) {
  return through.obj(function(file, enc, cb) {

    var contents = file.contents.toString(enc)
    var path = file.path

    combo({
      contents: contents,
      path: path,
      extra: config.extra,
      transform: config.transform,
      dir: config.dir
    }, function(htmlstr) {
      file.contents = new Buffer(htmlstr)
      cb(null, file)
    })

  })
}
