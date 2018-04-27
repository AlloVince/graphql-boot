import test from 'ava';
import { Types, utils, Scalars } from './../src';

test('utils.base64', (t) => {
  t.throws(() => utils.base64Encode());
  t.throws(() => utils.base64Decode());
  t.is(utils.base64Encode('foo'), 'Zm9v');
  t.is(utils.base64Decode('Zm9v'), 'foo');
});

test('utils.filterObject', (t) => {
  t.deepEqual(utils.filterObject({
    booleanFalse: false,
    booleanTrue: true,
    stringEmpty: '',
    stringSome: 'foo',
    numberZero: 0,
    number: 123,
    object: {},
    array: [],
    null: null,
    undefinedKey: undefined
  }), {
    booleanFalse: false,
    booleanTrue: true,
    stringEmpty: '',
    stringSome: 'foo',
    numberZero: 0,
    number: 123,
    object: {},
    array: []
  });
});


test('Cursor encode/decode', (t) => {
  t.is(new Types.Cursor({
    primaryKey: 'id', primaryValue: 1, field: 'createdAt', offset: 10
  }).toString(), 'cEs9aWQmcFY9MSZmPWNyZWF0ZWRBdCZvPTEw');
  t.deepEqual(Types.Cursor.factory('cEs9aWQmcFY9MSZmPWNyZWF0ZWRBdCZvPTEw'), new Types.Cursor({
    primaryKey: 'id', primaryValue: '1', field: 'createdAt', offset: '10'
  }));
});

test('ScalarRange', (t) => {
  const range = Scalars.Range('foo');
  t.is(range.name, 'foo');
});

test('Range match', (t) => {
  t.throws(() => Types.Range.factory('foo'), SyntaxError);
  t.throws(() => Types.Range.factory('[1,2'), SyntaxError);
  t.throws(() => Types.Range.factory('1,2'), SyntaxError);
  t.throws(() => Types.Range.factory('1,2)'), SyntaxError);
  t.throws(() => Types.Range.factory('1,2]'), SyntaxError);
  t.throws(() => Types.Range.factory('[12]'), SyntaxError);
  t.throws(() => Types.Range.factory('[,]'), SyntaxError);
  t.deepEqual(Types.Range.factory('[1,2]'), new Types.Range({
    query: {
      $gte: '1',
      $lte: '2'
    },
    fromOperator: '[',
    fromValue: '1',
    toValue: '2',
    toOperator: ']'
  }));
  t.deepEqual(Types.Range.factory('(foo,bar)'), new Types.Range({
    query: {
      $gt: 'foo',
      $lt: 'bar'
    },
    fromOperator: '(',
    fromValue: 'foo',
    toValue: 'bar',
    toOperator: ')'
  }));
  t.deepEqual(Types.Range.factory('(foo,]'), new Types.Range({
    query: {
      $gt: 'foo'
    },
    fromOperator: '(',
    fromValue: 'foo',
    toValue: undefined,
    toOperator: ']'
  }));
  t.deepEqual(Types.Range.factory('[,bar)'), new Types.Range({
    query: {
      $lt: 'bar'
    },
    fromOperator: '[',
    fromValue: undefined,
    toValue: 'bar',
    toOperator: ')'
  }));
});
