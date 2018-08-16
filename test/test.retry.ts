// Copyright 2018, Google, LLC.
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';

import {getch, GetchError, GetchOptions} from '../src';
import * as nock from 'nock';
import * as assert from 'assert';
const assertRejects = require('assert-rejects');

nock.disableNetConnect();

const url = 'https://example.com';

function getConfig(err: Error) {
  const e = err as GetchError;
  if (e && e.config && e.config.retryConfig) {
    return e.config.retryConfig;
  }
  return;
}

afterEach(() => {
  nock.cleanAll();
});

describe('🛸 retry & exponential backoff', () => {
  it('should provide an expected set of defaults', async () => {
    const scope = nock(url).get('/').times(4).reply(500);
    await assertRejects(getch({url, retry: true}), (e: Error) => {
      scope.done();
      const config = getConfig(e);
      if (!config) {
        assert.fail('no config available');
      }
      assert.equal(config!.currentRetryAttempt, 3);
      assert.equal(config!.retry, 3);
      assert.equal(config!.noResponseRetries, 2);
      assert.equal(config!.retryDelay, 100);
      const expectedMethods = ['GET', 'HEAD', 'PUT', 'OPTIONS', 'DELETE'];
      for (const method of config!.httpMethodsToRetry!) {
        assert(expectedMethods.indexOf(method) > -1);
      }
      const expectedStatusCodes = [[100, 199], [429, 429], [500, 599]];
      const statusCodesToRetry = config!.statusCodesToRetry!;
      for (let i = 0; i < statusCodesToRetry.length; i++) {
        const [min, max] = statusCodesToRetry[i];
        const [expMin, expMax] = expectedStatusCodes[i];
        assert.equal(min, expMin);
        assert.equal(max, expMax);
      }
      return true;
    });
  });

  it('should retry on 500 on the main export', async () => {
    const body = {buttered: '🥖'};
    const scopes =
        [nock(url).get('/').reply(500), nock(url).get('/').reply(200, body)];
    const res = await getch({
      url,
      retry: true,
    });
    assert.deepStrictEqual(res.data, body);
    scopes.forEach(s => s.done());
  });

  it('should not retry on a post', async () => {
    const scope = nock(url).post('/').reply(500);
    await assertRejects(
        getch({url, method: 'POST', retry: true}), (e: Error) => {
          const config = getConfig(e);
          return config!.currentRetryAttempt === 0;
        });
    scope.done();
  });

  it('should retry at least the configured number of times', async () => {
    const body = {dippy: '🥚'};
    const scopes = [
      nock(url).get('/').times(3).reply(500),
      nock(url).get('/').reply(200, body)
    ];
    const cfg = {url, retryConfig: {retry: 4}};
    const res = await getch(cfg);
    assert.deepStrictEqual(res.data, body);
    scopes.forEach(s => s.done());
  });

  it('should not retry more than configured', async () => {
    const scope = nock(url).get('/').twice().reply(500);
    const cfg = {url, retryConfig: {retry: 1}};
    await assertRejects(getch(cfg), (e: Error) => {
      return getConfig(e)!.currentRetryAttempt === 1;
    });
    scope.done();
  });

  it('should not retry on 4xx errors', async () => {
    const scope = nock(url).get('/').reply(404);
    await assertRejects(getch({url, retry: true}), (e: Error) => {
      const cfg = getConfig(e);
      return cfg!.currentRetryAttempt === 0;
    });
    scope.done();
  });

  it('should not retry if retries set to 0', async () => {
    const scope = nock(url).get('/').reply(500);
    const cfg = {url, retryConfig: {retry: 0}};
    await assertRejects(getch(cfg), (e: Error) => {
      const cfg = getConfig(e);
      return cfg!.currentRetryAttempt === 0;
    });
    scope.done();
  });

  it('should notify on retry attempts', async () => {
    const body = {buttered: '🥖'};
    const scopes =
        [nock(url).get('/').reply(500), nock(url).get('/').reply(200, body)];
    let flipped = false;
    const config: GetchOptions = {
      url,
      retryConfig: {
        onRetryAttempt: (err) => {
          const cfg = getConfig(err);
          assert.equal(cfg!.currentRetryAttempt, 1);
          flipped = true;
        }
      }
    };
    await getch(config);
    assert.equal(flipped, true);
    scopes.forEach(s => s.done());
  });

  it('should support overriding the shouldRetry method', async () => {
    const scope = nock(url).get('/').reply(500);
    const config = {
      url,
      retryConfig: {
        shouldRetry: () => {
          return false;
        }
      }
    };
    await assertRejects(getch(config), (e: Error) => {
      const cfg = getConfig(e);
      return cfg!.currentRetryAttempt === 0;
    });
    scope.done();
  });

  it('should retry on ENOTFOUND', async () => {
    const body = {spicy: '🌮'};
    const scopes = [
      nock(url).get('/').replyWithError({code: 'ENOTFOUND'}),
      nock(url).get('/').reply(200, body)
    ];
    const res = await getch({url, retry: true});
    assert.deepStrictEqual(res.data, body);
    scopes.forEach(s => s.done());
  });

  it('should retry on ETIMEDOUT', async () => {
    const body = {sizzling: '🥓'};
    const scopes = [
      nock(url).get('/').replyWithError({code: 'ETIMEDOUT'}),
      nock(url).get('/').reply(200, body)
    ];
    const res = await getch({url, retry: true});
    assert.deepStrictEqual(res.data, body);
    scopes.forEach(s => s.done());
  });

  it('should allow configuring noResponseRetries', async () => {
    const scope = nock(url).get('/').replyWithError({code: 'ETIMEDOUT'});
    const config = {url, retryConfig: {noResponseRetries: 0}};
    await assertRejects(getch(config), (e: Error) => {
      const cfg = getConfig(e);
      return cfg!.currentRetryAttempt === 0;
    });
    scope.done();
  });
});
