# hash-cache

  a simple, consistent on-disk cache.

## Design goals

  * Never return invalid data. Unless data has been proven to match the hash, it won't be returned.
    Many filesystems don't protect against data corruption, so it should be possible to even check verified files.
  * Be agnostic to what is being cached. As long as it arrives as a readable bytestream, it's cacheable.
  * Combine as many requests for the same thing as possible.
    Until the first byte flows out of the ReadStream, it combines every request into one.
  * Be optimistic.
    Don't check the cache and *then* get things from it. Try to get things from it, and if we hit an `ENOENT`, fall back.
  * Remain correct in the face of concurrency.
    We go to great lengths to ensure processes wait for each other and share work.
    Even across processes, requests are combined, safely.
    Only process-local failure is considered a hard failure.
  * Use as few file descriptors as possible.
    File descriptors are often scarce, and many operations can be run on an existing fd.

## API
### Cache(path)
### Cache({ path, paranoid = false, timeout })

  Returns an instance of the cache, storing its stuff at the given path.

  If a timeout is given (in milliseconds), the staleness check kicks in after 100ms of waiting for a temporary file.
  A working process resets the timeout on every write and every half timeout period.
  If the timeout passes, we remove the temporary file and try again.

  Paranoid mode, which is not enabled by default, ensures that files match the hash even if they're already cached.
  This is only applicable if you're not using a filesystem that ensures on-disk consistency (such as ZFS) for some reason.
  Personally, I'd consider it duct-tape in production systems.

#### cache.createReadStream(hash, …args)

  Returns a readable stream for the item in the cache with given hash. If the item is not found in the cache, it defers to `cache._createReadStream(hash, …args)`.
  This may emit an error on the stream, but never a single byte of wrong content.

#### cache._createHash()

  Should return an object conforming to node's hash interface. It should have an `.update(chunk)` method that allows updating the hash content with the given buffer, and a `.digest()` method that returns a digest as a buffer.

#### cache._createReadStream(hash, …args)

  Should return a readable stream that hopefully has contents matching the hash. All the arguments to `cache.createReadStream(hash, …args)` are simply passed on.

#### cache._storePath(hash)
#### cache._tmpPath(hash)

  Should return a path in the given place.

  Default implementations are provided:

```javascript
Cache.prototype._storePath = function(hash) { return Path.join(this.path, 'store', hash) }
Cache.prototype._tmpPath = function(hash) { return Path.join(this.path, 'tmp', hash) }
```

## Example

```javascript
'use strict';
module.exports = MyCache
var Cache = require('hash-cache')
  , crypto = require('crypto')
  , http = require('http')
  , through = require('through')

function MyCache(opts) { Cache.call(this, opts) }

MyCache.prototype._storePath = function(hash) { return Path.join(this.path, 'store', hash.slice(0, 2), hash) }
MyCache.prototype._tmpPath = function(hash) { return Path.join(this.path, 'tmp', hash.slice(0, 2), hash) }

MyCache.prototype._createHash = function() { return crypto.createHash('sha1') }

MyCache.prototype._createReadStream = function(hash, url) {
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
```

