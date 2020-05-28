const gulp = require('gulp')
const postcss = require('gulp-postcss')
const autoprefixer = require('autoprefixer')
const cssnano = require('cssnano')
const sourcemaps = require('gulp-sourcemaps')
const bytediff = require('gulp-bytediff')
const browserSync = require('browser-sync').create()
const chalk = require('chalk')
const rename = require('gulp-rename')
const filter = require('gulp-filter')
const flatten = require('gulp-flatten')
const babel = require('gulp-babel')
const terser = require('gulp-terser')
const posthtml = require('gulp-posthtml')
const posthtmlInclude = require('posthtml-include')
const htmlnano = require('htmlnano')
const sizereport = require('gulp-sizereport')
const postcssCssVariables = require('postcss-css-variables')
const postcssImport = require('postcss-import')
const postcssInlineSvg = require('postcss-inline-svg')
const postcssColorModFunction = require('postcss-color-mod-function').bind(null, {
  /* Use `.toRGBLegacy()` as other methods can result in lots of decimals */
  stringifier: (color) => color.toRGBLegacy()
})

const paths = {
  docs: { src: 'docs/**', dest: 'dist/docs' },
  styles: { src: 'src/builds/*.css', dest: 'dist', watch: 'src/**/*.css' }
}

// https://stackoverflow.com/a/20732091
const humanFileSize = (size) => {
  const i = Math.floor(Math.log(size) / Math.log(1024))
  return (size / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i]
}

const formatByteMessage = (source, data) => {
  const prettyStartSize = humanFileSize(data.startSize)
  let message = ''

  if (data.startSize !== data.endSize) {
    const change = data.savings > 0 ? 'saved' : 'gained'
    const prettySavings = humanFileSize(Math.abs(data.savings))
    let prettyEndSize = humanFileSize(data.endSize)

    if (data.endSize > data.startSize) prettyEndSize = chalk.yellow(prettyEndSize)
    if (data.endSize < data.startSize) prettyEndSize = chalk.green(prettyEndSize)

    message = chalk`${change} ${prettySavings} (${prettyStartSize} -> {bold ${prettyEndSize}})`
  } else message = chalk`kept original filesize. ({bold ${prettyStartSize}})`

  return chalk`{cyan ${source.padStart(12, ' ')}}: {bold ${data.fileName}} ${message}`
}

const style = () => {
  // const isLegacy = (path) => /legacy/.test(path)

  // const excludeModern = filter(file => isLegacy(file.path), { restore: true })
  // const excludeLegacy = filter(file => !isLegacy(file.path), { restore: true })

  // Don't inline minified versions, so builds can lazily import them at runtime
  const cssImportOptions = { filter: (path) => !/\.min/.test(path) }

  const startDiff = () => bytediff.start()
  const endDiff = (source) => bytediff.stop((data) => formatByteMessage(source, data))

  return (
    gulp
      .src(paths.styles.src)
      .pipe(sourcemaps.init())
      .pipe(postcss([postcssImport(cssImportOptions), postcssColorModFunction(), postcssInlineSvg()]))

      .pipe(startDiff())
      .pipe(postcss([postcssCssVariables({ preserve: true })]))
      .pipe(endDiff('css variables'))

      .pipe(startDiff())
      .pipe(postcss([autoprefixer({ env: 'legacy' })]))
      .pipe(endDiff('autoprefixer'))

      .pipe(sourcemaps.write('.'))
      .pipe(flatten()) // Put files in dist/*, not dist/builds/*
      .pipe(gulp.dest(paths.styles.dest))

      .pipe(filter('**/*.css')) // Remove sourcemaps from the pipeline

      // <minifying>
      .pipe(startDiff())
      .pipe(postcss([cssnano({ preset: ['default', { svgo: { floatPrecision: 0 } }] })]))
      .pipe(endDiff('minification'))
      .pipe(rename({ suffix: '.min' }))
      // </minifying>

      .pipe(sourcemaps.write('.'))
      .pipe(gulp.dest(paths.styles.dest))
      .pipe(gulp.dest(paths.docs.dest + '/water.css'))

      .pipe(filter('**/*.css')) // Remove sourcemaps from the pipeline
      .pipe(sizereport({ gzip: true, total: false, title: 'SIZE REPORT' }))
      .pipe(browserSync.stream())
  )

  // return gulp.parallel(
  //   gulp.src(paths.styles.src)
  //     .pipe(sourcemaps.init())
  // )

  return (
    gulp
      .src(paths.styles.src)
      // Add sourcemaps
      .pipe(sourcemaps.init())
      // Resolve imports, calculated colors and inlined SVG files
      .pipe(postcss([postcssImport(cssImportOptions), postcssColorModFunction(), postcssInlineSvg()]))

      // * Process legacy builds *
      .pipe(excludeModern)
      // Inline variable values so CSS works in legacy browsers
      .pipe(postcss([postcssCssVariables()]))
      // Calculate size before autoprefixing
      .pipe(bytediff.start())
      // autoprefix
      .pipe(postcss([autoprefixer({
        env: 'legacy'
      })]))
      // Write the amount gained by autoprefixing
      .pipe(bytediff.stop((data) => formatByteMessage('autoprefixer', data)))
      .pipe(excludeModern.restore)

      // * Process modern builds *
      .pipe(excludeLegacy)
      // Calculate size before autoprefixing
      .pipe(bytediff.start())
      // autoprefix modern builds
      .pipe(postcss([autoprefixer({
        env: 'modern'
      })]))
      // Write the amount gained by autoprefixing
      .pipe(bytediff.stop((data) => formatByteMessage('autoprefixer', data)))
      .pipe(excludeLegacy.restore)

      // Write the sourcemaps after making pre-minified changes
      .pipe(sourcemaps.write('.'))
      // Flatten output so files end up in dist/*, not dist/builds/*
      .pipe(flatten())
      // Write pre-minified styles
      .pipe(gulp.dest(paths.styles.dest))
      // Remove sourcemaps from the pipeline, only keep css
      .pipe(filter('**/*.css'))
      // Calculate size before minifying
      .pipe(bytediff.start())
      // Minify using cssnano, use extra-low precision while minifying inline SVGs
      .pipe(postcss([cssnano({ preset: ['default', { svgo: { floatPrecision: 0 } }] })]))
      // Write the amount saved by minifying
      .pipe(bytediff.stop((data) => formatByteMessage('cssnano', data)))
      // Rename the files have the .min suffix
      .pipe(rename({ suffix: '.min' }))
      // Write the sourcemaps after making all changes
      .pipe(sourcemaps.write('.'))
      // Write the minified files
      .pipe(gulp.dest(paths.styles.dest))
      // Output files to docs directory so documentation site can use them
      .pipe(gulp.dest(paths.docs.dest + '/water.css'))
      // Final size report including gzipped sizes
      .pipe(sizereport({ gzip: true, total: false, title: 'SIZE REPORT' }))
      // Stream any changes to browserSync
      .pipe(browserSync.stream())
  )
}

const docs = () => {
  const htmlOnly = filter('**/*.html', { restore: true })
  const jsOnly = filter('**/*.js', { restore: true })
  const cssOnly = filter('**/*.css', { restore: true })

  return (
    gulp
      // Exclude all HTML files but index.html
      .src(paths.docs.src, { ignore: '**/!(index).html' })

      // * Process HTML *
      .pipe(htmlOnly)
      .pipe(posthtml([posthtmlInclude({ root: './docs/' }), htmlnano()]))
      .pipe(htmlOnly.restore)

      // * Process JS *
      .pipe(jsOnly)
      .pipe(sourcemaps.init())
      .pipe(babel({ presets: ['@babel/preset-env'] }))
      .pipe(terser({ toplevel: true }))
      .pipe(sourcemaps.write('.'))
      .pipe(jsOnly.restore)

      // * Process CSS *
      .pipe(cssOnly)
      .pipe(sourcemaps.init())
      .pipe(postcss([cssnano()]))
      .pipe(sourcemaps.write('.'))
      .pipe(cssOnly.restore)

      .pipe(gulp.dest(paths.docs.dest))
  )
}

const browserReload = (done) => {
  browserSync.reload()
  return done()
}

const startDevServer = () => {
  browserSync.init({ server: { baseDir: './dist/docs' } })

  gulp.watch(paths.styles.watch, gulp.series(style, browserReload))
  gulp.watch(paths.docs.src, gulp.series(docs, browserReload))
}

const build = gulp.parallel(style, docs)
const watch = gulp.series(build, startDevServer)

module.exports.build = build
module.exports.watch = watch
