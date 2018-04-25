import fs from 'fs';
import path from 'path';
import glob from 'glob';
import assert from 'assert';
import merge from 'lodash.merge';
import { makeExecutableSchema } from 'graphql-tools';
import { GraphQLScalarType } from 'graphql'; //eslint-disable-line
import { Kind } from 'graphql/language'; //eslint-disable-line

export const utils = {
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
 * For supporting IDE syntax graphql```
 * @param v
 * @returns {string}
 */
export const graphql = v => v[0];

export class Range {
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
      return null;
    }
    const [, fromOperator, fromValue, toValue, toOperator] = matches;
    if (!fromValue && !toValue) {
      return null;
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
        const range = Range.factory(value);
        if (!range) {
          throw new SyntaxError();
        }
        return range;
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
        const startCharacter = value.slice(0, 1);
        return startCharacter === '-' ? {
          field: value.slice(1),
          direction: 'DESC'
        } : {
          field: startCharacter === '+' ? value.slice(1) : value,
          direction: 'ASC'
        };
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
