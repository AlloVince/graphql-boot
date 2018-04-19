import test from 'ava';
import { Range } from './../src';

test('Range match', (t) => {
  t.is(Range.factory('foo'), null);
  t.is(Range.factory('[1,2'), null);
  t.is(Range.factory('1,2)'), null);
  t.is(Range.factory('1,2]'), null);
  t.is(Range.factory('[12]'), null);
  t.is(Range.factory('[,]'), null);
  t.deepEqual(Range.factory('[1,2]'), new Range({
    query: {
      $gte: '1',
      $lte: '2'
    },
    fromOperator: '[',
    fromValue: '1',
    toValue: '2',
    toOperator: ']'
  }));
  t.deepEqual(Range.factory('(foo,bar)'), new Range({
    query: {
      $gt: 'foo',
      $lt: 'bar'
    },
    fromOperator: '(',
    fromValue: 'foo',
    toValue: 'bar',
    toOperator: ')'
  }));
  t.deepEqual(Range.factory('(foo,]'), new Range({
    query: {
      $gt: 'foo'
    },
    fromOperator: '(',
    fromValue: 'foo',
    toValue: undefined,
    toOperator: ']'
  }));
  t.deepEqual(Range.factory('[,bar)'), new Range({
    query: {
      $lt: 'bar'
    },
    fromOperator: '[',
    fromValue: undefined,
    toValue: 'bar',
    toOperator: ')'
  }));
});
