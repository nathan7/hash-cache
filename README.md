# hash-cache

  a simple, consistent on-disk cache.

## API

```javascript
var Cache = require('hash-cache')
  , crypto = require('crypto')
  , http = require('http')
  , through = require('through')

function HttpSha1Cache(path) {
  Cache.call(this, path)
}

HttpSha1Cache.prototype._createHash = function() { return crypto.createHash('sha1') }
HttpSha1Cache.prototype._createReadStream = function(hash, url) {
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

### Cache(path)
### Cache({ path, paranoid = false, timeout })

  Returns an instance of the cache, storing its stuff at the given path.

  If a timeout is given (in milliseconds), the staleness check kicks in after 100ms of waiting for a temporary file.
  When the last write is past the timeout, it'll remove the temporary file and try again.
  If the other process is still running, it's entirely unaware of this. It might move the half-written *new* temporary file into the cache.

  Paranoid mode, which is not enabled by default, ensures that files match the hash even if they're already cached.
  This is only applicable if you're not using a filesystem that ensures on-disk consistency (such as ZFS) for some reason.
  Personally, I'd consider it duct-tape in production systems.

#### cache.createReadStream(hash, …args)

  Returns a readable stream for the item in the cache with given hash. If the item is not found in the cache, it defers to `cache._createReadStream(hash, …args)`.
  This may return an error if the hash does not match, but never the wrong content.

#### cache._createHash()

  Should return an object conforming to node's hash interface. It should have an `.update(chunk)` method that allows updating the hash content with the given buffer, and a `.digest()` method that returns a digest as a buffer.

#### cache._createReadStream(hash, …args)

  Should return a readable stream that hopefully has contents matching the hash. All the arguments to `cache.createReadStream(hash, …args)` are simply passed on.

