# magix-combo
用来在无线端自动分析页面引用view的js，自动合并。也会合并引用的样式。


## Install

``` js
npm install magix-combo
```


## Usage

``` js
gulp.task("preCombo", ['copy'],function(callback) {
  return gulp.src('./build/**/**.html').pipe(combo({
    // 提供对html内容进行简单的替换功能
    transform: function(contents){
      // 修改cdn地址
      return contents.replace(/\/app\/pages/g,'//g-assets.daily.taobao.net/mm/sem-centre/' + VERSION)
    },
    // 额外的js入口分析文件，也会一起打包进入，主要是为了考虑 用户动态moutview的情况
    // return 一个数组
    extra: function(options){
      return ['app/views/center/main']
    }
  })).pipe(gulp.dest('./build'))
})

```
