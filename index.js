'use strict';
module.exports = Cache
var Path = require('path')
  , fs = require('fs')
  , mkdirp = require('mkdirp')
  , through = require('through')
  , Dict = require('dict')

function noop() {}
function unimplemented() { throw new Error('unimplemented') }

function Cache(opts) {
  if (!this || this === global) return new Cache(opts)

  if (typeof opts == 'string') opts = { path: opts }

  this.path = opts.path
  this.paranoid = !!opts.paranoid
  this.__pending = Dict()
}

Cache.prototype._createReadStream = unimplemented
Cache.prototype._createHash = unimplemented

Cache.prototype.createReadStream = function(digest) { var self = this
  var output = through()

  var input = this.__acquirePending(digest)
  if (input) return input.pipe(output)

  var store = Path.join(this.path, 'store', digest)
    , args = arguments

  return fs.createReadStream(store)
    .on('error', function(err) {
      if (err.code !== 'ENOENT') return error(err)

      var input = self.__acquirePending(digest)
      if (input) return input.pipe(output)

      self.__acquireFresh.apply(self, args)
        .on('error', error)
        .pipe(output)
    })
    .pipe(output)

  function error(err) { return output.emit('error', err) }
}

Cache.prototype.__acquirePending = function(digest) { return this.__pending.get(digest) }

Cache.prototype.__hash = function(stream, digest, cb) {
  var hash = this._createHash()
  return stream
    .on('data', function(chunk) { hash.update(chunk) })
    .on('end', function() {
      var actualDigest = Buffer(hash.digest()).toString('hex')
      if (actualDigest === digest) return cb()
      var err = new Error('hashes did not match. expected `' + digest + '`, got `' + actualDigest + '`')
      err.expected = digest
      err.actual = actualDigest
      cb(err)
    })
}

Cache.prototype.__acquireFresh = function(digest) { var self = this
  var output = through()
    , tmp = Path.join(this.path, 'tmp', digest)
    , store = Path.join(this.path, 'store', digest)
    , args = arguments

  this.__pending.set(digest, output)

  createInput()
  return output

  var input
  function createInput() {
    try { input = self._createReadStream.apply(self, args) }
    catch (e) { return error(e) }
    input.on('error', error)
    maketmp()
  }

  function maketmp() {
    mkdirp(Path.dirname(tmp), function(err) { if (err) error(err); else writeStream() })
  }

  function writeStream() {
    self.__hash(input, digest, compareHash)
      .pipe(fs.createWriteStream(tmp))
      .on('error', error)
  }

  function compareHash(err) {
    if (!err) return makeStore()

    fs.unlink(tmp, noop)
    return error(err)
  }

  function makeStore() {
    mkdirp(Path.dirname(store), function(err) { if (err) error(err); else rename() })
  }

  function rename() {
    fs.rename(tmp, store, function(err) { if (err) error(err); else deliver() })
  }

  function deliver() {
    fs.createReadStream(store).pipe(output)
    self.__pending['delete'](digest)
  }

  function error(err) { return output.emit('error', err) }
}
