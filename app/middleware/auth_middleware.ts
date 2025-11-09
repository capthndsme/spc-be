import type { HttpContext } from '@adonisjs/core/http'
import AuthService from '#service/AuthService'

export default async function authMiddleware({ request, response }: HttpContext, next: () => Promise<void>) {
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
  await next()
}

