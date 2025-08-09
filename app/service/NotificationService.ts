import Token from "#models/token";
import admin from 'firebase-admin'
 
import { initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { readFileSync } from "fs";
const serviceAccount = JSON.parse(readFileSync('/etc/key.json').toString())
 

class NotificationService { 

  readonly #app = initializeApp({
    credential: admin.credential.cert(serviceAccount)

  });
  readonly #messaging = getMessaging(this.#app);

  async sendNotificationsToAll(
    title: string,
    body: string,
    data?: any
  ) {
    const tokens = await Token.query().select("token")
    if (tokens.length === 0) {
      return false
    }
    const fcmTokens = tokens.map(t => t.token)
    const message = {
      notification: {
        title,
        body
      },
      data
    }
 
    
    await this.#messaging.sendEach(
      fcmTokens.map(d => ({
        ...message,
        token: d
      }))
    )
    return true
    
  }
  async upsertToken(
    userId: number,
    token: string
  ) {
    try {
      const tk = await Token.query().where("token", token).first()
      if (!tk) {
        await Token.create({
          userId,
          token
        })
      } else {
        tk.userId = userId
        await tk.save()
        
      }
      return true
    } catch (e) {
      return false
    }
  }

  async sendNotification(
    userId: number,
    title: string,
    body: string,
    data?: any
  ) {
    const tokens = await Token.query().where("userId", userId).select("token")
    if (tokens.length === 0) {
      return false
    }
    const fcmTokens = tokens.map(t => t.token)
    const message = {
      notification: {
        title,
        body
      },
      data
    }
 
    
    await this.#messaging.sendEach(
      fcmTokens.map(d => ({
        ...message,
        token: d
      }))
    )
    return true
    
  }
}




export default new NotificationService();