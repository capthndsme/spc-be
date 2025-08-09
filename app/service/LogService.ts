import Log, { LogType } from "#models/log";
import NotificationService from "./NotificationService.js";

class LogService {

  async createLogRecord(
    logType: LogType,
    dataMsg: string,
    photoImage?: string
    
  ) {
    try {
      console.log("Create log", logType, dataMsg, photoImage)
      await Log.create({
        logType,
        dataMsg,
        photoImage
      })

      // push notif here...
      try {
        /**
         * convert our logtype from AA_B_C format to
         * like Aa b c format.
         */
        const title = logType.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        
        
        await NotificationService.sendNotificationsToAll(
          `Log: ${title}`,
          `Message: ${dataMsg}`
        )
      } catch (e) {
        console.log("Notif send fail", e)
      }
    } catch(e) {
      console.log("Log fail")
      console.log(e);
    }
  }


  async getLogs(
    beforeId? : number,
    afterId?: number,
    limit = 50
  ) {
    const query = Log.query().orderBy('id', 'desc').limit(limit);

    if (beforeId) {
      query.where('id', '<', beforeId);
    }

    if (afterId) {
      query.where('id', '>', afterId);
    }

    return query.exec();
    
  }
}


export default new LogService();
