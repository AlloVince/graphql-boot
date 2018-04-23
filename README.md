# GraphQLBoot

[![NPM version](https://img.shields.io/npm/v/graphql-boot.svg?style=flat-square)](http://badge.fury.io/js/graphql-boot)
[![Build Status](https://travis-ci.org/AlloVince/graphql-boot.svg?branch=master)](https://travis-ci.org/AlloVince/graphql-boot)
[![Dependencies Status](https://david-dm.org/AlloVince/graphql-boot.svg)](https://david-dm.org/AlloVince/graphql-boot)
[![npm](https://img.shields.io/npm/dm/graphql-boot.svg?maxAge=2592000)](https://www.npmjs.com/package/graphql-boot)
[![License](https://img.shields.io/npm/l/graphql.svg?maxAge=2592000?style=plastic)](https://github.com/AlloVince/graphql-boot/blob/master/LICENSE)


Maybe the best practice for GraphQL on node.js project.

Features:

- Using decorator `@GraphqlSchema` to define GraphQL schema so that you could write schema & resolver together
- `graphql` tag for IDE syntax highlight
- Scanning all `*.graphqls` file as GraphQL schema, for better experience of WebStorm Plugin [JS GraphQL](https://github.com/jimkyndemeyer/js-graphql-intellij-plugin)
- Built-in common scalars such as `JSON`/`URL`/`Timestamp`/`Range`, etc.


Before using GraphQLBoot:

```js
var express = require('express');
var bodyParser = require('body-parser');
var { graphqlExpress, graphiqlExpress } = require('apollo-server-express');
var { makeExecutableSchema } = require('graphql-tools');

var typeDefs = [`
type Query {
  hello: String
}

schema {
  query: Query
}`];

var resolvers = {
  Query: {
    hello(root) {
      return 'world';
    }
  }
};

var schema = makeExecutableSchema({
  typeDefs,
  resolvers
});
var app = express();
app.use('/graphql', bodyParser.json(), graphqlExpress({schema}));
app.use('/graphiql', graphiqlExpress({endpointURL: '/graphql'}));
app.listen(4000, () => console.log('Now browse to localhost:4000/graphiql'));
```

After using GraphQLBoot:

```js
import GraphqlBoot, {GraphqlSchema, graphql} from 'graphql-boot';
import express from 'express';

const app = express();
const resolvers = {
  Query: {
    @GraphqlSchema(graphql`
        extend type Query {
            hello: String
        }
    `)    
    hello: async() => {
      return 'world';
    }
  }
}
const graphqlBoot = new GraphqlBoot();
app.use('/api', graphqlBoot.getMiddleware({resolvers}));
app.use('/ui', graphqlBoot.getUI({ endpointURL: '/v1/graphql/api' }));
app.listen(4000, () => console.log('Now browse to localhost:4000/graphiql'));
```

Check a full project to get more details: [avnpc.js](https://github.com/AlloVince/avnpc.js)