/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import AuthController from '#controllers/auth_controller'
import DashController from '#controllers/DashController'
import InternalsController from '#controllers/internals_controller'
import UsersController from '#controllers/UserController'
import router from '@adonisjs/core/services/router'

router.get('/', async () => {
  return {
    hello: 'world',
  }
})

router.group(() => {


  router.get('/users/me', [UsersController, 'getMe'])

  router.post('/login', [AuthController, 'login'])
  router.post('/users/create', [UsersController, 'createUser'])
  router.put('/users/modify', [UsersController, 'modifyUser'])
  router.delete('/users/delete/:id', [UsersController, 'deleteUser'])
  router.get('/users/list', [UsersController, 'listUsers'])
  router.get('/dash', [DashController, 'getDash'])
  router.post('/dash/tare', [DashController, 'tare'])

  /**
   * get slots
   */

  router.get('/slots', [DashController, 'getSlots'])
  router.post('/slots/update', [DashController, 'updateSlot'])

  /**
   * Orders
   */

  router.post('/orders/upsert', [DashController, 'upsertOrder'])
  router.get('/orders/:id', [DashController, 'getOrder'])
  router.get('/orders', [DashController, 'getOrders'])

  

  
})
router.post('/auth/login', [AuthController, 'login'])
// check auth api

// logout api


/**
 * INTERNAL ROUTES FOR TouchScreenApp
 */
router.group(() => {
  /**
 *  GPIO Controls
 */
  router.post("/wait-relock", [InternalsController, 'waitRelock'])

  // get order (internal usage)
  router.get('/orders/:id', [InternalsController, 'findOrderId'])

  // update order's number and send the one-time password
  router.post('/orders/otp', [InternalsController, 'sendOTP'])

  // validate otp
  router.post('/orders/validate', [InternalsController, 'validateOTP'])
  

  // dash data, used for detecting changes from 0 to 100 or whatever
  router.get('/dash', [DashController, 'getDash'])


})
  .prefix("/-internalFFXX-")



router.get("/ping", res => res.response.send({ ping: "pong" }))