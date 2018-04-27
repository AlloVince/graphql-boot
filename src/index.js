import fs from 'fs';
import path from 'path';
import glob from 'glob';
import assert from 'assert';
import querystring from 'querystring';
import merge from 'lodash.merge';
import { makeExecutableSchema } from 'graphql-tools';
import { GraphQLScalarType } from 'graphql'; //eslint-disable-line
import { Kind } from 'graphql/language'; //eslint-disable-line

const GRAPHQL_DEBUG = !!process.env.GRAPHQL_DEBUG;

export const utils = {
  /**
   * @param inputString
   * @returns {string}
   */
  base64Encode: inputString => Buffer.from(inputString).toString('base64'),
  /**
   * @param inputString
   * @returns {string}
   */
  base64Decode: inputString => Buffer.from(inputString, 'base64').toString('utf8'),
  /**
   * Remove null/undefined properties from an object
   * @param {object} inputObject
   * @returns {object}
   */
  filterObject: inputObject =>
    Object
      .entries(inputObject)
      .filter(([, value]) => value !== undefined && value !== null)
      .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {})

};

/**
 * For supporting IDE syntax graphql`
 * @param v
 * @returns {string}
 */
export const graphql = v => v[0];

class Cursor {
  constructor({
    primaryKey, primaryValue, field, offset
  }) {
    this.primaryKey = primaryKey;
    this.primaryValue = primaryValue ? Number.parseInt(primaryValue, 10) : null;
    assert(!Number.isNaN(this.primaryValue), 'primaryValue must be Number type');
    this.field = field;
    this.offset = Number.parseInt(offset, 10);
  }

  /**
   * @param {string} cursorString
   * @returns {Cursor}
   */
  static factory(cursorString) {
    const {
      pK: primaryKey, pV: primaryValue, f: field, o: offset
    } = querystring
      .parse(GRAPHQL_DEBUG
        ? cursorString
        : utils.base64Decode(cursorString));
    return new Cursor(utils.filterObject({
      primaryKey,
      primaryValue,
      field,
      offset
    }));
  }

  clone({ offset, primaryValue } = {}) {
    return new Cursor({
      primaryKey: this.primaryKey,
      primaryValue: primaryValue || this.primaryValue,
      field: this.field,
      offset: offset || this.offset
    });
  }

  /**
   * @returns {string}
   */
  toString() {
    const obj = utils.filterObject({
      pK: this.primaryKey,
      pV: this.primaryValue,
      f: this.field,
      o: this.offset
    });
    return GRAPHQL_DEBUG
      ? querystring.stringify(obj)
      : utils.base64Encode(querystring.stringify(obj));
  }
}

class Range {
  constructor({
    query,
    fromOperator,
    fromValue,
    toValue,
    toOperator
  }) {
    this.query = query;
    this.fromOperator = fromOperator;
    this.fromValue = fromValue;
    this.toValue = toValue;
    this.toOperator = toOperator;
  }

  /**
   * @param inputString
   * @returns {Range|null}
   */
  static factory(inputString) {
    const matches = /^([[(])([\w:-]+)?,([\w:-]+)?([\])])$/.exec(inputString);
    if (!matches) {
      throw new SyntaxError(`Scalar Range ${inputString} syntax incorrect`);
    }
    const [, fromOperator, fromValue, toValue, toOperator] = matches;
    if (!fromValue && !toValue) {
      throw new SyntaxError(`Scalar Range ${inputString} syntax incorrect`);
    }
    const query = {};
    if (fromValue) {
      Object.assign(query, { [fromOperator === '[' ? '$gte' : '$gt']: fromValue });
    }
    if (toValue) {
      Object.assign(query, { [toOperator === ']' ? '$lte' : '$lt']: toValue });
    }
    return new Range({
      query,
      fromOperator,
      fromValue,
      toValue,
      toOperator
    });
  }

  toString() {
    return `${this.fromOperator}${this.fromValue},${this.toValue}${this.toOperator}`;
  }
}

class SortOrder {
  constructor({
    field,
    direction
  }) {
    this.field = field;
    this.direction = direction;
  }

  static factory(inputString) {
    const matches = /^[+-]?\w+$/.exec(inputString);
    if (!matches) {
      throw new SyntaxError(`Scalar SortOrder ${inputString} syntax incorrect`);
    }
    const startCharacter = inputString.slice(0, 1);
    return startCharacter === '-' ? new SortOrder({
      field: inputString.slice(1),
      direction: 'DESC'
    }) : new SortOrder({
      field: startCharacter === '+' ? inputString.slice(1) : inputString,
      direction: 'ASC'
    });
  }

  toString() {
    return `${this.direction === 'DESC' ? '-' : ''}${this.field}`;
  }

  toArray(secondaryOrder) {
    if (!secondaryOrder) {
      return [[this.field, this.direction]];
    }
    const subOrder = SortOrder.factory(secondaryOrder);
    return this.field === subOrder.field
      ? [[this.field, this.direction]]
      : [[this.field, this.direction], [subOrder.field, subOrder.direction]];
  }
}

export const Types = {
  Range,
  SortOrder,
  Cursor
};


export class Connection {
  constructor({
    totalCount,
    first,
    after,
    last,
    before,
    order,
    defaultOrder,
    secondaryOrder,
    primaryKey,
    maxLimit = 100
  }) {
    assert((first || last), 'Making connection require (first or last)');
    assert((order || defaultOrder) && maxLimit, 'Making connection require (order || defaultOrder) & max limit');

    this.order = order ? Types.SortOrder.factory(order) : Types.SortOrder.factory(defaultOrder);
    assert((first && this.order.direction === 'ASC') || (last && this.order.direction === 'DESC'), 'Param first require ASC order, param last require DESC order');

    this.totalCount = totalCount || null;
    this.secondaryOrder = secondaryOrder;
    this.primaryKey = primaryKey;
    this.nodes = null;
    this.cursor = null;

    if (first) {
      this.limit = first;
      this.cursor = after ? Types.Cursor.factory(after) : new Types.Cursor({
        primaryKey,
        field: this.order.field,
        offset: 0
      });
    } else if (last) {
      this.limit = last;
      this.cursor = before ? Types.Cursor.factory(before) : new Types.Cursor({
        primaryKey,
        field: this.order.field,
        offset: 0
      });
    }
    assert(this.limit < maxLimit, 'Too many query items');
  }

  /**
   * @returns {Types.Cursor}
   */
  getCursor() {
    return this.cursor;
  }

  getSqlQuery(extraQuery = {}) {
    const {
      primaryKey, primaryValue, offset
    } = this.getCursor();
    const { field } = this.order;
    if (primaryKey && field === primaryKey && primaryValue) {
      return {
        where: {
          [primaryKey]: this.order.direction === 'ASC' ? {
            $gt: primaryValue
          } : {
            $lt: primaryValue
          }
        },
        limit: this.limit,
        order: this.order.toArray(this.secondaryOrder)
      };
    }
    return merge({
      offset,
      limit: this.limit,
      order: this.order.toArray(this.secondaryOrder)
    }, extraQuery);
  }

  setTotalCount(totalCount) {
    this.totalCount = totalCount;
    return this;
  }

  setNodes(nodes) {
    this.nodes = nodes;
    return this;
  }

  getEdges() {
    if (!this.nodes) {
      return [];
    }
    const { offset } = this.cursor;
    return this.nodes.map((node, index) => ({
      cursor: this.cursor.clone({
        primaryKey: this.primaryKey,
        primaryValue: node[this.primaryKey],
        offset: offset + index + 1
      }).toString(),
      node
    }));
  }

  getTotalCount() {
    return this.totalCount;
  }

  getPageInfo() {
    assert(!Number.isNaN(Number.parseInt(this.totalCount, 10)), 'SetTotalCount required before getPageInfo');
    const cursor = this.getCursor();
    const { offset } = cursor;
    const isFirst = offset <= 0;
    const isLast = offset + this.limit >= this.totalCount;
    return {
      startCursor: cursor.toString(),
      endCursor: cursor.clone({ offset: offset + this.limit }).toString(),
      hasNextPage: !isLast,
      hasPreviousPage: !isFirst
    };
  }

  toJSON() {
    return {
      totalCount: this.getTotalCount(),
      pageInfo: this.getPageInfo(),
      edges: this.getEdges(),
      nodes: this.nodes
    };
  }
}

export const Scalars = {
  /**
   * @param name
   * @returns {GraphQLScalarType}
   * @constructor
   */
  Range: (name = 'Range') =>
    new GraphQLScalarType({
      name,
      description: `The Range scalar type defined two values as a value range: 
    - [fromValue,toValue] means greater than equal fromValue, less than equal toValue,
    - (fromValue,toValue) means greater than fromValue, less than toValue`,
      serialize: v => v,
      parseValue: v => v,
      parseLiteral: (ast) => {
        const { kind, value } = ast;
        if (kind !== Kind.STRING) {
          throw new SyntaxError();
        }
        return Range.factory(value);
      }
    }),

  /**
   * @param name
   * @returns {GraphQLScalarType}
   * @constructor
   */
  SortOrder: (name = 'SortOrder') =>
    new GraphQLScalarType({
      name,
      description: `The SortOrder scalar type defined a string with prefix +(optional) or -: 
  - +createdAt/createdAt means order field is \`createdAt\`, sort order is ASC
  - -createdAt means order field is \`createdAt\`, sort order is DESC`,
      serialize: v => v,
      parseValue: v => v,
      parseLiteral: (ast) => {
        const { kind, value } = ast;
        if (kind !== Kind.STRING) {
          throw new SyntaxError();
        }
        return SortOrder.factory(value);
      }
    }),

  /**
   * @param name
   * @returns {GraphQLScalarType}
   * @constructor
   */
  JSON: (name = 'JSON') => {
    function parseLiteral(ast, variables) {
      switch (ast.kind) {
        case Kind.STRING:
        case Kind.BOOLEAN:
          return ast.value;
        case Kind.INT:
        case Kind.FLOAT:
          return parseFloat(ast.value);
        case Kind.OBJECT: {
          const value = Object.create(null);
          ast.fields.forEach((field) => {
            value[field.name.value] = parseLiteral(field.value, variables);
          });

          return value;
        }
        case Kind.LIST:
          return ast.values.map(n => parseLiteral(n, variables));
        case Kind.NULL:
          return null;
        case Kind.VARIABLE: {
          const keyName = ast.name.value;
          return variables ? variables[keyName] : undefined;
        }
        default:
          return undefined;
      }
    }

    return new GraphQLScalarType({
      name,
      description:
      'The `JSON` scalar type represents JSON values as specified by ' +
      '[ECMA-404](http://www.ecma-international.org/' +
      'publications/files/ECMA-ST/ECMA-404.pdf).',
      serialize: v => v,
      parseValue: v => v,
      parseLiteral
    });
  },

  /**
   * @param name
   * @returns {GraphQLScalarType}
   * @constructor
   */
  UnixTimestamp: (name = 'UnixTimestamp') =>
    new GraphQLScalarType({
      name,
      description: 'The UnixTimestamp scalar type defined a positive integer as ' +
      'the number of seconds since 00:00:00 UTC on January 1, 1970',
      serialize: v => v,
      parseValue: v => v,
      parseLiteral: (ast) => {
        const { kind, value } = ast;
        if (kind !== Kind.INT || value > 9999999999) {
          throw new SyntaxError();
        }
        return value;
      }
    })
};

/**
 * Use as resolver properties decorator
 * @param schema
 * @returns {function(*, *=, *)}
 * @constructor
 */
export const GraphqlSchema = schema =>
  (target, key, descriptor) => {
    target.__graphqlSchemas = target.__graphqlSchemas || []; //eslint-disable-line
    target.__graphqlSchemas.push({ resolverName: key, schema }); //eslint-disable-line
    return descriptor;
  };


export default class GraphqlBoot {
  constructor({ schemaScanPath = null, builtinScalars = Scalars } = {}) {
    this._typeDefs = [`type Query {
      # Service health check
      health: Boolean!
    }`];
    this._resolvers = {
      Query: { health: () => true }
    };
    this.schemaScanPath = schemaScanPath || path.normalize(`${__dirname}/../*/**/*.graphqls`);
    if (builtinScalars) {
      Object
        .entries(builtinScalars)
        .forEach(([scalarName, scalarDefine]) => {
          this.addScalar(`scalar ${scalarName}\n`, { [scalarName]: scalarDefine(scalarName) });
        });
    }
  }

  /**
   * @param resolvers
   * @returns {Array}
   */
  getTypeDefsFromResolvers(resolvers) {
    let typeDefs = [];
    const extractTypeDefs = ([key, resolverFuncs]) => {
      assert(
        typeof key === 'string' && typeof resolverFuncs === 'object' && resolverFuncs !== null,
        'Resolver must be a 2 depth object such like { Query: { foo: () => {} } }'
      );
      const { __graphqlSchemas: graphqlSchemas } = resolverFuncs;
      if (graphqlSchemas) {
        typeDefs = typeDefs.concat(graphqlSchemas.map(s => s.schema));
      }
    };
    for (const resolver of resolvers) {
      Object
        .entries(resolver)
        .forEach(extractTypeDefs);
    }
    return typeDefs;
  }

  /**
   * @param typeDefs
   * @param resolvers
   * @returns {GraphQLSchema}
   */
  getSchema({ typeDefs, resolvers }) {
    const typeDefsFromResolvers = this.getTypeDefsFromResolvers(resolvers);
    return makeExecutableSchema({
      typeDefs: [...this.getTypeDefs(), ...typeDefs, ...typeDefsFromResolvers],
      resolvers: merge({}, this.getDefaultResolvers(), ...resolvers)
    });
  }

  /**
   * @returns {string[]}
   */
  getDefaultTypeDefs() {
    return this._typeDefs;
  }

  /**
   * @returns {{Query: {health: function(): boolean}}|*}
   */
  getDefaultResolvers() {
    return this._resolvers;
  }

  /**
   * @param typeDef
   * @returns {GraphqlBoot}
   */
  addTypeDef(typeDef) {
    this._typeDefs.push(typeDef);
    return this;
  }

  /**
   * @param resolver
   * @returns {GraphqlBoot}
   */
  addResolver(resolver) {
    merge(this._resolvers, resolver);
    return this;
  }

  /**
   * @returns []
   */
  getTypeDefs() {
    const typeDefs = [...this.getDefaultTypeDefs()];
    const typeDefFiles = glob.sync(this.schemaScanPath);
    typeDefFiles.forEach((file) => {
      typeDefs.push(fs.readFileSync(file).toString());
    });
    return typeDefs;
  }

  /**
   * @param schema
   * @param resolver
   * @returns {GraphqlBoot}
   */
  addScalar(schema, resolver) {
    this._typeDefs.push(schema);
    merge(this._resolvers, resolver);
    return this;
  }
}
