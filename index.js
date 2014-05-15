'use strict';
module.exports = Cache
var Path = require('path')
  , fs = require('fs')
  , mkdirp = require('mkdirp')
  , through = require('through')
  , Dict = require('dict')

function noop() {}
function unimplemented() { throw new Error('unimplemented') }

function Cache(path) {
  if (!this || this === global) return new Cache(path)

  this.path = path
  this.__pending = new Dict()
}

Cache.prototype._createReadStream = unimplemented
Cache.prototype._createHash = unimplemented

Cache.prototype.createReadStream = function(digest) { var self = this
  var output = through()
    , store = Path.join(this.path, 'store', digest)

  var pending = this.__pending.get(digest)
  if (pending)
    return pending
      .on('error', error)
      .pipe(output)

  var args = arguments
  fs.createReadStream(store)
    .on('open', function() { this.pipe(output) })
    .on('error', function(err) {
      if (err.code !== 'ENOENT') return error(err)
      self.__acquire.apply(self, args)
        .pipe(output)
        .on('error', error)
    })

  return output

  function error(err) { return output.emit('error', err) }
}

Cache.prototype.__acquire = function(digest) { var self = this
  var output = this.__pending[digest] = through()
    , tmp = Path.join(this.path, 'tmp', digest)
    , store = Path.join(this.path, 'store', digest)
    , args = arguments

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

  var hash
  function writeStream() {
    hash = self.createHash()

    input
      .on('data', function(chunk) { hash.update(chunk) })
      .on('end', compareHash)
      .pipe(fs.createWriteStream(tmp))
      .on('error', error)
  }

  function compareHash() {
    var actualDigest = (new Buffer(hash.digest())).toString('hex')
    if (actualDigest === digest) return makeStore()

    fs.unlink(tmp, noop)
    var err = new Error('hashes did not match. expected `' + digest + '`, got `' + actualDigest + '`')
    err.expected = digest
    err.actual = actualDigest
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
    delete self.__pending[digest]
  }

  function error(err) { return output.emit('error', err) }
}
