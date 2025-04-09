import Token from "#models/token";
import { Bcrypt } from "@adonisjs/core/hash/drivers/bcrypt";
import { randomBytes } from "crypto";
import User from "#models/user";

class AuthService {

  readonly #bcrypt = new Bcrypt({})

  async validToken(token: string|null|undefined, user: number|null) {
    
    if (!token) return false;

    if (!user) return false;
    
    const hasToken = await Token.query()
    .where('token', token)
    .where('user_id', user)
    .first()

    return Boolean(hasToken)
  }

  async makeLogin(username: string, password: string) {
    const user = await User.query().where('username', username).first()
    if (!user) throw new Error("User not found")
      
    const valid = await this.#bcrypt.verify(user.password!, password );
    if (valid) {
      console.log("login success - make token")
      const nTk = randomBytes(36).toString('hex');
      await Token.create({
        token: nTk,
        userId: user.id
      })
      return {
        token: nTk,
        userId: user.id
      };
    } else {
      throw new Error("Invalid password")
    }
  }
}

export default new AuthService();