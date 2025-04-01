/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import AuthController from '#controllers/auth_controller'
import UsersController from '#controllers/UserController'
import router from '@adonisjs/core/services/router'

router.get('/', async () => {
  return {
    hello: 'world',
  }
})

router.group(() => {
 
  
  router.get('/users/me', [UsersController, 'getMe'])

  router.post('/login', [AuthController, 'login'] )
  router.post('/users/create', [UsersController, 'createUser'])
  router.put('/users/modify', [UsersController, 'modifyUser'])
  router.delete('/users/delete/:id', [UsersController, 'deleteUser'])
  router.get('/users/list', [UsersController, 'listUsers'])

  
})
router.post('/api/auth/login', [AuthController, 'login'])