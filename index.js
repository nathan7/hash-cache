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
  this.timeout = opts.timeout | 0
  this.__pending = Dict()
}

Cache.prototype._createReadStream = unimplemented
Cache.prototype._createHash = unimplemented

Cache.prototype.createReadStream = function(digest) { var self = this
  var output = through()

  var pending = this.__pending.get(digest)
  if (!pending) {
    pending = through()
      .once('readable', function() { self.__pending.delete(digest) })
    pending.setMaxListeners(0)
    this.__pending.set(digest, pending)
    this.__acquireFs(arguments, pending)
  }

  return pending
    .on('error', function(err) { output.emit('error', err) })
    .pipe(output)
}


Cache.prototype.__store = function(digest) { return Path.join(this.path, 'store', digest) }
Cache.prototype.__tmp = function(digest) { return Path.join(this.path, 'tmp', digest) }

Cache.prototype.__acquireFs = function(args, pending, paranoid) { var self = this
  var digest = args[0]

  var input = fs.createReadStream(this.__store(digest))
    .on('error', function(err) {
      if (err.code !== 'ENOENT') return pending.emit('error', err)
      self.__acquireFresh(args, pending)
    })

  if (!this.paranoid || paranoid === false)
    return input.on('open', function() { this.pipe(pending) })

  this.__hash(input, digest, function(err) {
    if (err) return pending.emit(err)
    self.__acquireFs(args, pending, false)
  })
}

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

Cache.prototype.__acquireFresh = function(args, pending) { var self = this
  var digest = args[0]
    , store = this.__store(digest)
    , tmp = this.__tmp(digest)

  mkdirp(Path.dirname(tmp), function(err) { if (err) error(err); else writeStream() })

  var output
  function writeStream() {
    fs.createWriteStream(tmp, { flags: 'wx' })
      .on('open', function() {
        // it's ours! yay!
        output = this
        readStream()
      })
      .on('error', function(err) {
        if (err.code !== 'EEXIST') return error(err)
        // someone else has already started fetching this
        // let's watch if they finish
        fs.watch(tmp)
          .on('change', function() {
            if (timeout) clearTimeout(timeout)
            this.close()
            // something changed! let's go check if our file is in the store now.
            self.__acquireFs(args, pending)
          })
          .on('error', function(err) {
            if (timeout) clearTimeout(timeout)
            this.close()
            if (err.code !== 'ENOENT') return error(err)
            // they already finished while we were firing up our watcher. let's have another go at everything.
            self.__acquireFs(args, pending)
          })

        // if we have a timeout, let's check if things haven't gone stale
        // we'll leave this until the next 100ms so we don't fire this up too quickly, stat calls cost
        var timeout
        if (self.timeout) setTimeout(checkStale, 100)
        function checkStale() {
          timeout = null
          fs.stat(tmp, function(err, stats) {
            // disappeared in the meanwhile, the watcher will have caught this
            if (err && err.code === 'ENOENT') return
            if (err) return error(err)
            var delta = new Date() - stats.mtime
            if (delta < self.timeout) return
            fs.unlink(tmp, function(err) {
              if (err && err.code === 'ENOENT') return
              if (err) return error(err)
            })
          })
        }
      })
  }

  var input
  function readStream() {
    try { input = self._createReadStream.apply(self, args) }
    catch (e) { return error(e) }
    input.on('error', error)
    pipe()
  }

  function pipe() {
   self.__hash(input, digest, compareHash)
      .pipe(output)
  }

  function compareHash(err) {
    if (!err) return makeStore()

    fs.unlink(tmp, noop)
    error(err)
  }

  function makeStore() {
    mkdirp(Path.dirname(store), function(err) { if (err) error(err); else rename() })
  }

  function rename() {
    // if our tmpfile has been unlinked due to timeouts, we fail hard here.
    // even worse, if someone else has started writing, we put a partial file there.
    // that's unfortunate, but there's not a lot better we can do.
    fs.rename(tmp, store, function(err) { if (err) error(err); else deliver() })
  }

  function deliver() {
    fs.createReadStream(store).pipe(pending)
  }

  function error(err) { return pending.emit('error', err) }
}
