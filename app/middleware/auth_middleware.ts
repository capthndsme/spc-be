import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import AuthService from '../service/AuthService.js'

export default class AuthMiddleware {
  public async handle({ request, response }: HttpContext, next: NextFn) {
    try {
      const token = request.header('Authorization')?.replace('Bearer ', '')
      const userIdHeader = request.header('X-user-id')
      const userId = userIdHeader ? Number(userIdHeader) : null
      const ok = await AuthService.validToken(token, userId)
      if (!ok) {
        return response.status(403).send('Unauthorized')
      }
    } catch {
      return response.status(403).send('Unauthorized')
    }
    return next()
  }
}

