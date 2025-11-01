const axios = require('axios');

const instance = axios.create({
  baseURL: 'http://api-gateway:8080/api/patients', // Route through gateway to patient-service
});

module.exports = instance;
