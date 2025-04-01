import app from "@adonisjs/core/services/app";
 
 
 

app.ready(async () => {

  if (app.getEnvironment() === "web") {
    const {default: TheService} =  await import("../app/service/TheService.js");
    console.log("booting 3")
    TheService.boot()
    console.log('The service booted')
  } 

  
 

})