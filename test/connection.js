import test from 'ava';
import assert from 'assert';
import { Connection, Types } from './../src';

test('Make connection: basic input', (t) => {
  t.throws(() => new Connection({}), assert.AssertionError, /first or last/);
  t.throws(() => new Connection({ first: 10 }), assert.AssertionError, /order/);
  t.throws(() => new Connection({ first: 10, defaultOrder: '-id' }), assert.AssertionError, /ASC/);
  t.throws(() => new Connection({ last: 10, defaultOrder: 'id' }), assert.AssertionError, /ASC/);
  t.throws(() => new Connection({
    first: 1000,
    defaultOrder: '-id',
    maxLimit: 999
  }), assert.AssertionError, /Too many/);
});

test('Make connection: cursor', (t) => {
  let c = new Connection({ first: 10, order: 'id' });
  t.deepEqual(c.getCursor(), new Types.Cursor({ field: 'id', offset: 0 }));
  t.deepEqual(c.limit, 10);
  t.deepEqual(c.order, new Types.SortOrder({ field: 'id', direction: 'ASC' }));

  c = new Connection({ last: 10, order: '-id' });
  t.deepEqual(c.getCursor(), new Types.Cursor({ field: 'id', offset: 0 }));
  t.deepEqual(c.limit, 10);
  t.deepEqual(c.order, new Types.SortOrder({ field: 'id', direction: 'DESC' }));
});


test('Make connection: cursor with primaryKey', (t) => {
  let c = new Connection({ first: 10, order: 'id', primaryKey: 'id' });
  t.deepEqual(c.getCursor(), new Types.Cursor({ field: 'id', offset: 0, primaryKey: 'id' }));
  t.deepEqual(c.limit, 10);
  t.deepEqual(c.order, new Types.SortOrder({ field: 'id', direction: 'ASC' }));

  c = new Connection({ last: 10, order: '-id', primaryKey: 'id' });
  t.deepEqual(c.getCursor(), new Types.Cursor({ field: 'id', offset: 0, primaryKey: 'id' }));
  t.deepEqual(c.limit, 10);
  t.deepEqual(c.order, new Types.SortOrder({ field: 'id', direction: 'DESC' }));
});


test('Make connection: query basic', (t) => {
  t.deepEqual(new Connection({ first: 10, order: 'id' }).getSqlQuery(), {
    offset: 0,
    limit: 10,
    order: [['id', 'ASC']]
  });
  t.deepEqual(new Connection({ last: 10, order: '-id' }).getSqlQuery(), {
    offset: 0,
    limit: 10,
    order: [['id', 'DESC']]
  });

  t.deepEqual(new Connection({
    first: 10,
    order: 'id',
    after: new Types.Cursor({ field: 'id', offset: 100 }).toString()
  }).getSqlQuery(), {
    offset: 100,
    limit: 10,
    order: [['id', 'ASC']]
  });

  t.deepEqual(new Connection({
    last: 10,
    order: '-id',
    before: new Types.Cursor({ field: 'id', offset: 100 }).toString()
  }).getSqlQuery(), {
    offset: 100,
    limit: 10,
    order: [['id', 'DESC']]
  });
});

test('Make connection: query with primary key', (t) => {
  t.deepEqual(new Connection({
    first: 10,
    order: 'id',
    primaryKey: 'id',
    after: new Types.Cursor({
      field: 'id', offset: 100, primaryKey: 'id', primaryValue: 999
    }).toString()
  }).getSqlQuery(), {
    where: {
      id: { $gt: 999 }
    },
    limit: 10,
    order: [['id', 'ASC']]
  });

  t.deepEqual(new Connection({
    last: 10,
    order: '-id',
    primaryKey: 'id',
    before: new Types.Cursor({
      field: 'id', offset: 100, primaryKey: 'id', primaryValue: 999
    }).toString()
  }).getSqlQuery(), {
    where: {
      id: { $lt: 999 }
    },
    limit: 10,
    order: [['id', 'DESC']]
  });
});


test('Make connection: query with primary key but order not primary key', (t) => {
  t.deepEqual(new Connection({
    first: 10,
    order: 'createdAt',
    primaryKey: 'id',
    after: new Types.Cursor({
      field: 'createdAt', offset: 100, primaryKey: 'id', primaryValue: 999
    }).toString()
  }).getSqlQuery(), {
    offset: 100,
    limit: 10,
    order: [['createdAt', 'ASC']]
  });

  t.deepEqual(new Connection({
    first: 10,
    order: 'createdAt',
    primaryKey: 'id',
    after: new Types.Cursor({
      field: 'id', offset: 100, primaryKey: 'id', primaryValue: 999
    }).toString()
  }).getSqlQuery(), {
    offset: 100,
    limit: 10,
    order: [['createdAt', 'ASC']]
  });

  t.deepEqual(new Connection({
    last: 10,
    order: '-createdAt',
    primaryKey: 'id',
    before: new Types.Cursor({
      field: 'createdAt', offset: 100, primaryKey: 'id', primaryValue: 999
    }).toString()
  }).getSqlQuery(), {
    offset: 100,
    limit: 10,
    order: [['createdAt', 'DESC']]
  });

  t.deepEqual(new Connection({
    last: 10,
    order: '-createdAt',
    primaryKey: 'id',
    before: new Types.Cursor({
      field: 'id', offset: 100, primaryKey: 'id', primaryValue: 999
    }).toString()
  }).getSqlQuery(), {
    offset: 100,
    limit: 10,
    order: [['createdAt', 'DESC']]
  });
});


test('Make connection: getPageInfo', (t) => {
  t.throws(() => new Connection({ first: 10, order: 'id' }).getPageInfo(), assert.AssertionError, /SetTotalCount/);

  t.deepEqual(new Connection({
    first: 10,
    order: 'id'
  }).setTotalCount(11).getPageInfo(), {
    startCursor: new Types.Cursor({ field: 'id', offset: 0 }).toString(),
    endCursor: new Types.Cursor({ field: 'id', offset: 10 }).toString(),
    hasNextPage: true,
    hasPreviousPage: false
  });

  t.deepEqual(new Connection({
    first: 10,
    order: 'id'
  }).setTotalCount(1).getPageInfo(), {
    startCursor: new Types.Cursor({ field: 'id', offset: 0 }).toString(),
    endCursor: new Types.Cursor({ field: 'id', offset: 10 }).toString(),
    hasNextPage: false,
    hasPreviousPage: false
  });

  t.deepEqual(new Connection({
    first: 10,
    after: new Types.Cursor({ field: 'id', offset: 90 }).toString(),
    order: 'id'
  }).setTotalCount(91).getPageInfo(), {
    startCursor: new Types.Cursor({ field: 'id', offset: 90 }).toString(),
    endCursor: new Types.Cursor({ field: 'id', offset: 100 }).toString(),
    hasNextPage: false,
    hasPreviousPage: true
  });
});