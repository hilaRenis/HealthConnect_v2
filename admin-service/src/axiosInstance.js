const axios = require('axios');

const instance = axios.create({
  baseURL: 'http://api-gateway:8080', // Route through gateway to downstream services
});

module.exports = instance;
