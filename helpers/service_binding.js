'use strict'
// TODO: refactor
// TODO: provide options for persistence? KVM?

var config = require('../helpers/config')
var service_instance = require('./service_instance')
var async = require('async')
var proxy = require('./edge_proxy')
var template = require('es6-template-strings')
var saveBinding = require('./datastore')[config.get('cf_broker').datastore].saveBinding
var deleteBinding = require('./datastore')[config.get('cf_broker').datastore].deleteBinding
var mgmt_api = require('./mgmt_api')

function create (route, callback) {
  async.waterfall([ function (cb) {
    // retrieve service instance details
    getServiceInstanceOrg(route, function (err, data) {
      if (err) {
        cb(new Error('Failed to retrieve service instance details.'))
        return
      } else {
        // data is {org: 'orgname', env: 'envname'}
        data.route = route
        cb(null, data)
      }
    }) },
    // create proxy
    function (data, cb) {
      createProxy(data, function (err, result) {
        if (err) {
          console.log('createProxy error: ' + err + ' - ' + result)
          cb(new Error('Failed creating proxy in org.'))
          return
        } else {
          // result needs to have URL details in it
          cb(null, result)
        }
      })
    },
    // store binding details
    function (data, cb) {
      saveBinding(data, function (err, result) {
        if (err) {
          cb(new Error('Failed saving binding details.'))
          return
        } else {
          cb(null, result)
        }
      })
    }],
    function (err, result) {
      if (err) {
        callback(new Error('Route Binding Failure: ' + err.message), null)
      } else {
        // need to call back with URL details for forwarding
        callback(null, result)
      }
    })
}

// create proxy in edge org
function createProxy (data, cb) {
  var org = data.org
  var env = data.env
  var route = data.route
  // TODO: this is brittle. Refactor. Goal is to support some configurability, but the code needs to match the template, or the avaliable variables need to be documented
  var routeName = route.bind_resource.route
  var proxyName = template(config.get('apigee_edge').proxy_name_pattern, { routeName: routeName })
  proxy.upload({org: org, env: env, proxyname: proxyName, basepath: '/' + route.binding_id}, function (err, data) {
    if (err) {
      cb('proxy failure.', err)
    } else {
      var proxyHost = config.get('apigee_edge').proxy_host
      var proxyUrlRoot = template(config.get('apigee_edge').proxy_host_pattern, { org: org, env: env, proxyHost: proxyHost })
      route.proxyURL = 'https://' + proxyUrlRoot + '/' + route.binding_id // TODO: this should use URL lib
      console.log('route proxy url: ' + route.proxyURL)
      cb(null, route)
    }
  })
}

// retrieve org/environment
function getServiceInstanceOrg (route, cb) {
  service_instance.get(route.instance_id, function (err, data) {
    if (err) {
      // error retrieving details of service instance
      console.error('service_binding.getServiceInstanceOrg error', err)
      cb(err, data)
    } else {
      // get org and environment and continue
      console.log('service_binding.getServiceInstanceOrg: ' + JSON.stringify(data))
      var org = data.apigee_org
      var env = data.apigee_env
      cb(null, {org: org, env: env})
    }
  })
}

function deleteServiceBinding (route, callback) {
  /* route is
  {
    instance_id: req.params.instance_id,
    binding_id: req.params.binding_id,
    service_id: req.query.service_id,
    plan_id: req.query.plan_id
  }
  */
  async.series([ function (cb) {
    mgmt_api.undeployProxy(route, function (err, result) {
      if (err) {
        cb(err)
      } else {
        cb(null)
      }
    })
  }, function (cb) {
    // delete data
    deleteBinding(route, function (err, result) {
      if (err) {
        cb(err)
      } else {
        cb(null, {})
      }
    })
  }], function (err, result) {
    if (err) {
      callback(new Error('Route Un-binding Failure: ' + err.message), null)
    } else {
      // need to call back with URL details for forwarding
      callback(null, result)
    }
  })
}

module.exports = {
  create: create,
  delete: deleteServiceBinding
}