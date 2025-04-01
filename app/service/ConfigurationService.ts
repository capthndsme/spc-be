
import env from '#start/env';
import { readFileSync, writeFile } from 'fs';


class Config { 

  tare: number;
  readonly #confUrl = env.get('DATA_PATH') + "/config.json"

  constructor() {
    // load or restore password
    const defConfig = {
      tare: 104.01
    }

    // nodejs

    try {
      const data = readFileSync(this.#confUrl, { encoding: 'utf8', flag: 'r' });
      const config = JSON.parse(data);
      this.tare = config.tare;
    } catch (error) {
      console.warn("No config file found, creating a default one");
      this.tare = defConfig.tare;
      this.save();
    }
    
  }

  async save() {
    const config = {
      tare: this.tare
    }
    const json = JSON.stringify(config);
    
 
 
    writeFile(this.#confUrl, json, 'utf8', (err: any) => {
      if (err) {
        console.error('Error writing to config file:', err);
      } else {
        console.log('Config file updated successfully.');
      }
    });
    

  }
  
}

export default new Config();