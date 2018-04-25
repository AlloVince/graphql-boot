const fs = require('fs');

let core = null;
try {
  fs.accessSync(__dirname + '/lib/index.js', fs.R_OK);
  core = require('./lib');
  //Use babel polyfill when node version < 8
  if (!global._babelPolyfill && process.version.substr(1, 1) < 8) {
    require('babel-polyfill');
  }
} catch (e) {
  core = require('./src');
}

exports = module.exports = core;
