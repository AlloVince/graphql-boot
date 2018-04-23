import fs from 'fs';
import path from 'path';
import glob from 'glob';
import merge from 'lodash.merge';
import { graphiqlExpress, graphqlExpress } from 'apollo-server-express/dist/index';
import { makeExecutableSchema } from 'graphql-tools';
import { GraphQLScalarType } from 'graphql';
import { Kind } from 'graphql/language';

/**
 * For supporting IDE syntax graphql`
 * @param v
 * @returns {*}
 */
export const graphql = v => v[0];

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

/**
 * @param name
 * @returns {GraphQLScalarType}
 * @constructor
 */
export const scalarTimestamp = (name = 'Timestamp') =>
  new GraphQLScalarType({
    name,
    description: 'The Timestamp scalar type defined a positive integer as ' +
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
  });

/**
 * @param name
 * @returns {GraphQLScalarType}
 * @constructor
 */
export const scalarJSON = (name = 'JSON') => {
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
};

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

/**
 * @param name
 * @returns {GraphQLScalarType}
 */
export const scalarRange = (name = 'Range') =>
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
  });

export const scalarSortOrder = (name = 'SortOrder') =>
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
        order: 'DESC'
      } : {
        field: startCharacter === '+' ? value.slice(1) : value,
        order: 'ASC'
      };
    }
  });

export default class GraphqlBoot {
  constructor({ schemaScanPath = null } = {}) {
    this.schemas = [`type Query {
      # Service health check
      health: Boolean!
    }`];
    this.resolvers = {
      Query: { health: () => true }
    };
    this.schemaScanPath = schemaScanPath || path.normalize(`${__dirname}/../*/**/*.graphqls`);
    this
      .addScalarJSON()
      .addScalarRange()
      .addScalarTimestamp()
      .addScalarSortOrder();
  }

  /**
   * @param endpointURL
   * @returns {(req: "express".e.Request, res: "express".e.Response, next: any) => void}
   */
  getUI({ endpointURL }) {
    return graphiqlExpress({ endpointURL });
  }

  /**
   * @param resolvers
   * @returns {Array}
   */
  getTypeDefsFromResolvers(resolvers) {
    let typeDefs = [];
    const extractSchemas = ([, resolverFuncs]) => {
      const { __graphqlSchemas: graphqlSchemas } = resolverFuncs;
      if (graphqlSchemas) {
        typeDefs = typeDefs.concat(graphqlSchemas.map(s => s.schema));
      }
    };
    for (const resolver of resolvers) {
      Object
        .entries(resolver)
        .forEach(extractSchemas);
    }
    return typeDefs;
  }

  /**
   * @param typeDefs
   * @param resolvers
   * @returns {ExpressHandler}
   */
  getMiddleware({ typeDefs, resolvers }) {
    const typeDefsFromResolvers = this.getTypeDefsFromResolvers(resolvers);
    return graphqlExpress({
      schema: makeExecutableSchema({
        typeDefs: [...this.getSchemas(), ...typeDefs, ...typeDefsFromResolvers],
        resolvers: merge(this.getDefaultResolvers(), ...resolvers)
      })
    });
  }

  /**
   * @returns {string[]}
   */
  getDefaultSchemas() {
    return this.schemas;
  }

  /**
   * @returns {{Query: {health: function(): boolean}}|*}
   */
  getDefaultResolvers() {
    return this.resolvers;
  }

  /**
   * @param schema
   * @returns {GraphqlBoot}
   */
  addSchema(schema) {
    this.schemas.push(schema);
    return this;
  }

  /**
   * @param resolver
   * @returns {GraphqlBoot}
   */
  addResolver(resolver) {
    merge(this.resolvers, resolver);
    return this;
  }

  /**
   * @returns []
   */
  getSchemas() {
    const schemas = [...this.getDefaultSchemas()];
    const schemaFiles = glob.sync(this.schemaScanPath);
    schemaFiles.forEach((file) => {
      schemas.push(fs.readFileSync(file).toString());
    });
    return schemas;
  }


  /**
   * @returns {GraphqlBoot}
   */
  addScalarTimestamp() {
    return this.addScalar(
      'scalar Timestamp\n',
      {
        Timestamp: scalarTimestamp()
      }
    );
  }

  /**
   * @returns {GraphqlBoot}
   */
  addScalarSortOrder() {
    return this.addScalar(
      'scalar SortOrder\n',
      {
        SortOrder: scalarSortOrder()
      }
    );
  }

  /**
   * @returns {GraphqlBoot}
   */
  addScalarRange() {
    return this.addScalar(
      'scalar Range\n',
      {
        Range: scalarRange()
      }
    );
  }

  /**
   * @returns {GraphqlBoot}
   */
  addScalarJSON() {
    return this.addScalar(
      'scalar JSON\n',
      {
        JSON: scalarJSON()
      }
    );
  }

  /**
   * @param schema
   * @param resolver
   * @returns {GraphqlBoot}
   */
  addScalar(schema, resolver) {
    this.schemas.push(schema);
    merge(this.resolvers, resolver);
    return this;
  }
}
