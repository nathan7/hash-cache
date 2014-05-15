'use strict';
var Cache = require('./')
  , fs = require('fs')
  , mkdirp = require('mkdirp')
  , crypto = require('crypto')
  , through = require('through')
  , http = require('http')
  , path = __dirname + '/test'
  , cache = Cache(path)

mkdirp.sync(path + '/output')

cache._createHash = function() { return crypto.createHash('sha1') }
cache._createReadStream = function(hash, url) {
  var stream = through()
  http.get(url)
    .on('response', function(res) {
      if (res.statusCode === 200) return res.pipe(stream)
      var err = new Error('HTTP ' + res.statusCode)
      err.statusCode = res.statusCode
      stream.emit('error', err)
    })
    .on('error', function(err) { stream.emit('error', err) })
  return stream
}

cache
  .createReadStream('4f8edd5e8cfb55cd2755ac6505593c2b4d5510f8', 'http://registry.npmjs.org/npm/-/npm-1.4.10.tgz')
  .pipe(fs.createWriteStream(path + '/output/npm' + rand() + '.tgz'))

cache
  .createReadStream('4f8edd5e8cfb55cd2755ac6505593c2b4d5510f8', 'http://registry.npmjs.org/npm/-/npm-1.4.10.tgz')
  .pipe(fs.createWriteStream(path + '/output/npm' + rand() + '.tgz'))

function rand() {
  return (Math.random() * 0xFFFFFFFF) | 0
}
