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

  Returns an instance of the cache, storing its stuff at the given path.

#### cache.createReadStream(hash, …args)

  Returns a readable stream for the item in the cache with given hash. If the item is not found in the cache, it defers to `cache._createReadStream(hash, …args)`.
  This may return an error if the hash does not match, but never the wrong content.
  Note that on-disk corruption *after* something has been written to the cache is not taken into account — you're assumed to be using a sane filesystem that ensures on-disk consistency, such as ZFS.

#### cache._createHash()

  Should return an object conforming to node's hash interface. It should have an `.update(chunk)` method that allows updating the hash content with the given buffer, and a `.digest()` method that returns a digest as a buffer.

#### cache._createReadStream(hash, …args)

  Should return a readable stream that hopefully has contents matching the hash. All the arguments to `cache.createReadStream(hash, …args)` are simply passed on.

