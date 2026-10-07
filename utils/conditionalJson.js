// JSON responses the browser may keep and revalidate: a weak ETag over the body
// plus `private, no-cache`, so a repeat request for unchanged data is a 304
// with no body. (index.js stamps `no-store` on every /api response by default;
// this replaces it for the routes that opt in.)

const crypto = require('crypto');

const etagOf = (json) => `W/"${crypto.createHash('sha1').update(json).digest('base64').slice(0, 22)}"`;

function sendConditionalJson(req, res, data) {
  const json = JSON.stringify(data);
  const etag = etagOf(json);
  res.set('ETag', etag);
  res.set('Cache-Control', 'private, no-cache');
  res.removeHeader('Pragma');
  res.removeHeader('Expires');
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.locals.__bwBytes = Buffer.byteLength(json);
  res.type('application/json').send(json);
}

module.exports = { sendConditionalJson, etagOf };
