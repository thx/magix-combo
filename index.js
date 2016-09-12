var mdeps = require('module-deps')
var JSONStream = require('JSONStream')
var Es = require('event-stream')
var fs = require('fs')
var path = require('path')
var dirname = path.dirname
var process = require('process')
var through = require('through2')
var combineTool = require('magix-combine')

var magixViewReg = /(?:mx|data)-view\s*=\s*\\?("[^"]*"|'[^']*'|[^'">\s]*)/g
var cssReg = /Magix\.applyStyle\((?:"[^"]*"|'[^']*'|[^'">\s\n]*)\,?\s*("[^"]*"|'[^']*'|[^'">\s\n]*)\)/g

var seaContents = fs.readFileSync(__dirname + '/sea.js')
var rootBase = process.cwd()

var innerJsPath = ''
var innerCssPath = ''
var cssContents = ''
var jsContents = ''



// 配置magix combine
combineTool.config({
  prefix: 'mx',
  tmplFolder: './',
  tmplCommand: /<%[\s\S]+?%>/g,
  loaderType: 'cmd'
})

// 分析页面中有哪些view
var collectViews = function(pageHtml) {

  var results = [],
    match, basename, file
  while (match = magixViewReg.exec(pageHtml)) {
    basename = match[1].replace(/'|"|\\/g, '')
    file = rootBase + '/' + basename + '.js'
    if (fs.existsSync(file)) {
      results.push({
        id: basename,
        isView: true,
        file: file
      })
    }
  }

  return results
}

var generateDics = function(viewLists, callback) {

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
  viewLists.forEach(function(resource) {
    md.write(resource)
  })
  md.end()
}

var wrapDefine = function(dic,callback){
  //对source进行加工，变成amd里面define的包裹格式
  if (!/define\s*\(\s*['"]\s*[\w\/]+['"]/.test(dic.source) && !dic.isBoot) {
    combineTool.processContent(dic.file, '', dic.source).then(function(source) {
      callback(source)
    })
  }else{
    callback(dic.source)
  }
}




module.exports = function(config) {

  return through.obj(function(file, enc, cb) {

    var contents = file.contents.toString(enc)
    var filePath = file.path
    var extName = path.extname(filePath)

    innerJsPath = filePath.replace(extName, '.js')
    innerCssPath = filePath.replace(extName, '.less')

    jsContents =  '' // fs.readFileSync(innerJsPath)
    cssContents = fs.readFileSync(innerCssPath)

    var resultHtml = ''
    if (config.transform) {
      resultHtml = config.transform(contents)
    }else{
      resultHtml = contents
    }



    var hasHandled = {}
    var handleDicLists = []

    var collectInnerDics = function(source,callback){
      // 处理html，需要递归的去找里面的view
      var viewLists = collectViews(source)

      if (!viewLists || viewLists.length === 0){
        callback()
        return
      }

      generateDics(viewLists,function(dicsArray){

        handleDicLists = handleDicLists.concat(dicsArray)
        callback()
      })
    }

    var handleDic = function(dic,next){
      if (hasHandled[dic.id]){
        next()
        return
      }else{
        hasHandled[dic.id] = true
      }
      wrapDefine(dic,function(source){

        // 处理css
        source = source.replace(cssReg, function(match, css) {
          cssContents += css.replace(/'|"/g, '')
          return ''
        })
        // 合并js
        if (dic.isBoot) {
          jsContents = jsContents + source
        }else{
          jsContents = source + jsContents
        }
        // 对于view来说，我们还要递归去找子view
        if (/Magix\.View/.test(source)) {
          collectInnerDics(source,function(){
            next()
          })
        }else{
          next()
        }

      })
    }

    var handleDicArray = function(callback){
      var next = function() {
        var one = handleDicLists.shift()

        if (one) {
          handleDic(one, next)
        }else{
          callback && callback()
        }
      }
      next()
    }

    /*分析html页面，生成对应的js*/
    var combo = function(options, callback) {
      var pageHtml = options.contents

      var viewLists = collectViews(pageHtml, options)
      // 加入入口js
      viewLists.push({
        id: innerJsPath,
        isBoot: true,
        file: innerJsPath
      })

      // 加入extra
      var extra = options.extra

      if (extra && extra instanceof Function) {
        var extraJs = extra(options) || []
        for (var i = 0; i < extraJs.length; i++) {
          viewLists.push({
            id: extraJs[i],
            isView: true,
            file: rootBase + '/' + extraJs[i] + '.js'
          })
        }
      }

      generateDics(viewLists,function(dicsArray){

        handleDicLists = handleDicLists.concat(dicsArray)
        handleDicArray(function(){
          var pagePath = options.path.replace('html', '')
          fs.writeFileSync(innerJsPath, seaContents + jsContents)
          fs.writeFileSync(innerCssPath, cssContents)
          callback()
        })

      })

    }

    combo({
      contents: contents,
      path: filePath,
      extra: config.extra,
      transform: config.transform,
      dir: config.dir
    }, function() {
      file.contents = new Buffer(resultHtml)
      cb(null, file)
    })

  })
}
