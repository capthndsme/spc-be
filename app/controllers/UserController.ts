import type { HttpContext } from '@adonisjs/core/http'
import UserService from '../service/UserService.js';

export default class UsersController {
  async createUser({ request, response }: HttpContext) {
    const userDetails = request.body() as unknown as {
      name: string;
      username: string;
      password: string;
    };

    if (typeof userDetails !== "object") return response.status(400).send("Invalid request")

    if (typeof userDetails.name !== "string" || typeof userDetails.username !== "string" || typeof userDetails.password !== "string") return response.status(400).send("Invalid request")

    const actorUserId = Number(request.header("X-user-id") ?? -1);
    try {
      const user = await UserService.createUser(userDetails, actorUserId);
      response.status(201).send(user);
    } catch (e) {
      response.status(400).send(e.message)
    }
  }

  async modifyUser({ request, response }: HttpContext) {
    const userDetails = request.body();
    const actorUserId = Number(request.header("X-user-id") ?? -1);
    try {
      const user = await UserService.modifyUserDetails(userDetails, actorUserId);
      response.status(200).send(user);
    } catch (e) {
      response.status(400).send(e.message)
    }
  }

  async deleteUser({ request, response }: HttpContext) {
    const { id } = request.params();
    const actorUserId = Number(request.header("X-user-id") ?? -1);
    try {
      const user = await UserService.adminDelete(actorUserId, Number(id));
      response.status(200).send(user);
    } catch (e) {
      response.status(400).send(e.message)
    }
  }

  async listUsers({ request, response }: HttpContext) {
    const actorUserId = Number(request.header("X-user-id") ?? -1);
    try {
      const users = await UserService.listUsers(actorUserId);
      response.status(200).send(users);
    } catch (e) {
      response.status(400).send(e.message)
    }
  }
  
  async getMe({ request, response }: HttpContext) {
    const actorUserId = Number(request.header("X-user-id") ?? -1);
    try {
      const user = await UserService.getMe(actorUserId.toString());
      response.status(200).send(user);
    } catch (e) {
      response.status(400).send(e.message)
    }

  }

}