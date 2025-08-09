import User from "#models/user";
import { Bcrypt } from "@adonisjs/core/hash/drivers/bcrypt";


class UserService {

  readonly #bcrypt = new Bcrypt({})

  async createUser(userDetails: {
    name: string;
    username: string;
    password: string;
  }, actorUserId: number) {
    
    // find user
    const actorUser = await User.query().where("id", actorUserId).first();
    if (!actorUser) throw new Error("User not found")

    if (!actorUser.superAdmin) throw new Error("You are not allowed to create new users")

    // validate username doesnt exist

    const exists = await User.query().where('username', userDetails.username).first();
    if (exists) throw new Error("Username already exists");
    

    // hash user
    const hash = await this.#bcrypt.make(userDetails.password)


    // save user ?

    const newUser = await User.create({
      username: userDetails.username,
      name: userDetails.name,
      password: hash,
      superAdmin: false, // CAN NEVER ADD NEW SUPERS.
      enabled: true
    })


    // ret new user
    return newUser;
    
  }

  async modifyUserDetails(
    userDetails: Partial<User>,
    actorUserId: number
  ) {
    // find the user
    const user = await User.query().where("id", actorUserId).first();
    if (!user) throw new Error("User not found")

    // validation
    if (user.id !== actorUserId) {
      throw new Error("You are not allowed to modify this user")
    }

    // update
    if (userDetails.name) user.name = userDetails.name;
    if (userDetails.password) user.password = await this.#bcrypt.make(userDetails.password);
    
    await user.save();
    return user;
  }

  async adminDelete(actorUserId: number, targetUserId: number) {
    // actor find
    const actorUser = await User.query().where("id", actorUserId).first();
    if (!actorUser) throw new Error("User not found")

    if (!actorUser.superAdmin) throw new Error("You are not allowed to delete users")

    // target find
    const targetUser = await User.query().where("id", targetUserId).first();
    if (!targetUser) throw new Error("User not found")

    await targetUser.delete();
    return targetUser;

  }



  async listUsers(actorUserId: number) {
    // actor find
    const actorUser = await User.query().where("id", actorUserId).first();
    if (!actorUser) throw new Error("User not found")

    if (!actorUser.superAdmin) throw new Error("You are not allowed to list users")

    // list users
    const users = await User.query().orderBy('id', 'asc');
    return users.map(user => ({
      id: user.id,
      name: user.name,
      username: user.username,
      enabled: user.enabled,
      superAdmin: user.superAdmin,
    }));

  }

  async getMe(actorUserId: string) {
    const user = await User.query().where("id", actorUserId).first();
    if (!user) throw new Error("User not found");
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      enabled: user.enabled,
      superAdmin: user.superAdmin,
    };

  }




}


export default new UserService();