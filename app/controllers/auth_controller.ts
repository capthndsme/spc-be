import type { HttpContext } from '@adonisjs/core/http'
import AuthService from '../service/AuthService.js';

export default class AuthController {
  async login({request, response}: HttpContext) {
    const {username, password} = request.body();
    console.log({username, password})
    try {
      const s = await AuthService.makeLogin(username,password);
      response.status(201).send(s);
    } catch (e) {
      response.status(403).send("Invalid password")
      console.log('inval pass', e)
    }
    
  
  }


  async validateToken({request, response}: HttpContext) {
    const token = request.header('Authorization')?.replace('Bearer ', '');
    const user = request.header('X-user-id');
    try {
      const s = await AuthService.validToken(token, Number(user));
      response.status(200).send(s);
    } catch (e) {
      response.status(403).send("Invalid token")
      console.log('inval token', e)
    }
  }
  
}