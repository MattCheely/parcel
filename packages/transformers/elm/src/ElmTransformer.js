// @flow

import {Transformer} from '@parcel/plugin';
import commandExists from 'command-exists';
import spawn from 'cross-spawn';
import path from 'path';
import {minify} from 'terser';

export default new Transformer({
  async getConfig({asset, localRequire, options}) {
    // Base config
    let config = {
      cwd: path.dirname(asset.filePath),
      debug: options.mode !== 'production',
      optimize: options.minify
    };

    // Install elm locally if it is not installed globally.
    try {
      await commandExists('elm');
    } catch (err) {
      config.pathToElm = installElm(asset, localRequire);
    }

    await ensureElmJson(asset, config.pathToElm);

    return config;
  },

  async transform({asset, config, options, localRequire}) {
    const elm = await localRequire('node-elm-compiler', asset.filePath);

    const dependencies = await elm.findAllDependencies(asset.filePath);
    dependencies.forEach(async dependency => {
      await asset.addConnectedFile({filePath: dependency});
    });

    let contents = await elm.compileToString(asset.filePath, config);

    if (options.hot) {
      let {inject} = await localRequire('elm-hot', asset.filePath);
      contents = inject(contents);
    }

    if (options.minify) {
      contents = minifyElm(contents);
    }

    console.log('build done');
    return [
      {
        type: 'js',
        dependencies: '',
        code: contents
      }
    ];
  }
});

// Utility Functions

async function installElm(asset, localRequire) {
  await localRequire('elm', asset.filePath);
  return path.join(path.dirname(require.resolve('elm')), 'bin', 'elm');
}

async function ensureElmJson(asset, pathToElm) {
  const elmJson = await asset.getConfig(['elm.json']);
  if (!elmJson) {
    createElmJson(pathToElm);
    // Watch the new elm.json for changes
    await asset.getConfig(['elm.json']);
  }
}

async function createElmJson(pathToElm) {
  let elmProc = spawn(pathToElm || 'elm', ['init']);
  elmProc.stdin.write('y\n');

  return new Promise((resolve, reject) => {
    elmProc.on('error', reject);
    elmProc.on('close', function(code) {
      if (code !== 0) {
        return reject(new Error('elm init failed.'));
      }

      return resolve();
    });
  });
}

// Recommended minification
// Based on:
// - http://elm-lang.org/0.19.0/optimize
function minifyElm(source) {
  let options = {
    compress: {
      keep_fargs: false,
      passes: 2,
      pure_funcs: [
        'F2',
        'F3',
        'F4',
        'F5',
        'F6',
        'F7',
        'F8',
        'F9',
        'A2',
        'A3',
        'A4',
        'A5',
        'A6',
        'A7',
        'A8',
        'A9'
      ],
      pure_getters: true,
      unsafe: true,
      unsafe_comps: true
    },
    mangle: true,
    rename: false
  };

  let result = minify(source, options);

  if (result.error) {
    throw result.error;
  }

  return result.code;
}
