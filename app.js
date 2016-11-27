var application_root = __dirname,
    express = require("express"),
    path = require("path"),
    mongoose = require('mongoose'),
    bodyParser = require('body-parser'),
    methodOverride = require('method-override'),
    morgan = require('morgan');

mongoose.Promise = require('bluebird');


var app = express();

// database
console.log("Connecting to db...");
mongoose.connect(process.env.MONGO);

// config
app.use(bodyParser.json());
app.use(methodOverride());
app.use(express.static(path.join(application_root, "public")));
app.use(clientErrorHandler);
app.use(errorHandler);
app.use(morgan('combined'));


var Schema = mongoose.Schema; //Schema.ObjectId

// Schemas

var Advisors = new Schema({
    name: { type: String, required: [true, "Must have a name"] },
    status: { 
        type: String, 
        required: [true, "Must have a status"], 
        enum: ["Busy", "Available", "Unavailable"] ,
        default: "Unavailable"
      },
    turnOverRate: { type: Number },
    avgPerHour: { type: Number },
    modified: { type: Date, default: Date.now }
});

var AdvisorModel = mongoose.model('Advisor', Advisors);

var Students = new Schema({
    name: { 
      type: String, 
      required: [true, "Must have a student name"],
      min: 2,
      max: 50
    },
    phoneNumber: { 
      type: Number, 
      validate: function(phoneNumber) { return phoneNumber.length == 10 }
    },
    studenId: { type: Number, required: [true, "Student ID is required"] },
    modified: { type: Date, default: Date.now }
});


// Appointment Model
var Appointment = new Schema({
    description: { 
      type: String, 
      required: [true, 'Description required'],
      min: 5,
      max: 100
    },
    student: [Students],
    advisorId: { 
      type: String, 
      required: [true, 'Advisor required for appointment'],
      default: "Next Advisor"
    },
    state: { 
      type: String,
      enum: ['Waiting', 'In Progress', 'Done'],
      default: 'Waiting',
    },
    type: { 
        type: String, 
        enum: ['Advising', 'Drop', 'Other'],
        required: 'Wrong Appointment Type or No appointment Type'
    },
    extraInfo: { type: String },
    position: { type: Number, default: -1 },
    modified: { type: Date, default: Date.now }
});


var AppointmentModel = mongoose.model('Appointment', Appointment);

/* Appointment Document 
{  
  "description": "I need to DROP",    
  "type": "Drop",
  "student": [{
    "name": "Leeroy Jenkins",
    "studenId": 10005959
  }],
  "advisorId" : "5833af88321f5f26ccd9231b",
  "extraInfo": "Hey, where is Dr. Beckers office?"
  "state": "Waiting" ( optional or for updates)
}
*/

/* Advisor Document
    {
        "name": "Barach",
        "status": "Busy"
    }
*/


// Queue stuff
console.log("Initializing queue...");
var queue = [];

var promise = AppointmentModel.find().exec() 

promise.then(function(appointment) {
  console.log("Saved queue");
  console.log(appointment);
  for(var i = 0; i < appointment.length; i++) {
    if(appointment.state !== "Done") {
      var pos = appointment[i].position;
      queue[pos] = appointment[i];
    }
  }
})
.catch(function(err) {
  console.log(err);
  console.log("Could not recover stored state");
});

function dequeue_app(idx) {
  if(queue.length == 1) {
    console.log("Queue length of 1 making new Array");
    queue = [];
  } 
  else {
    console.log("Removing -> " + queue[idx])
    for(var i = idx; i < queue.length - 1; i++) {
      console.log("UDATE -> " + queue[i+1].id);
      var promise = AppointmentModel.findById(queue[i+1].id).exec();
      promise.then(function(appointment) {
        console.log("Updating -> " + appointment)
        appointment.position = i;
        return appointment.save();
      })
      .then(function(appointment) {
        queue[i] = queue[i + 1];
        queue[i].position = i;
      })
      .catch(function(err) {
        console.log(err);
      })
    }
    queue.pop();
  }
}


// function move(to_pos, from_pos) {
//   if(idx < 0) return;
//   for(var i = to_pos; i < queue.length; i++) {
//     var temp = queue[to_pos];
//     queue[to_pos] = queue[from_pos];
//   }
// }

// REST api

app.get('/api', function (req, res) {
  res.send('Kiosk API is running');
});

// POST to CREATE
app.post('/api/appointments', function (req, res) {
  var appointment = new AppointmentModel({
    description: req.body.description,
    student: req.body.student,
    advisorId: req.body.advisorId,
    type: req.body.type,
    extraInfo: req.body.extraInfo,
    position: queue.length
  });
  
  appointment.save(function (err) {
    if (!err) {
      queue.push(appointment);
      console.log("Place in queue");
      console.log(queue[queue.length - 1].position)
      return res.send(appointment)
    } else {
      return res.send(err)
    }
  });
});

// PUT to UPDATE

// Bulk update
// app.put('/api/appointments', function (req, res) {
//     var i, len = 0;
//     console.log("is Array req.body.appointment");
//     console.log(Array.isArray(req.body.appointment));
//     console.log("PUT: (appointment)");
//     console.log(req.body.appointment);
//     if (Array.isArray(req.body.appointment)) {
//         len = req.body.appointment.length;
//     }
//     for (i = 0; i < len; i++) {
//         console.log("UPDATE appointment by id:");
//         for (var id in req.body.appointment[i]) {
//             console.log(id);
//         }
//         AppointmentModel.update({ "_id": id }, req.body.appointment[i][id], function (err, numAffected) {
//             if (err) {
//                 console.log("Error on update");
//                 console.log(err);
//                 return res.send(err);
//             } else {
//                 console.log("updated num: " + numAffected);
//                 return res.send(req.body.appointment)
//             }
//         });
//     }
// });

// Single update
app.put('/api/appointments/:id', function (req, res) {
  return AppointmentModel.findById(req.params.id, function (err, appointment) {
    appointment.description = req.body.description;
    appointment.student = req.body.student;
    appointment.advisor = req.body.advisor;
    appointment.type = req.body.type;
    appointment.extraInfo = req.body.extraInfo;
    return appointment.save(function (err) {
      if (!err) {
        console.log("updated");
        queue[appointment.position] = appointment;
        return res.send(appointment);
      } else {
        console.log(err);
        return res.send(err);
      }
    });
  });
});

// Update Appointment state
app.put('/api/appointments/:id/state', function (req, res) {
  return AppointmentModel.findById(req.params.id, function (err, appointment) {
    appointment.state = req.body.state;
    return appointment.save(function (err) {
      if (!err) {
        console.log("updated");
        queue[appointment.position] = appointment;
        return res.send(appointment);
      } else {
        console.log(err);
        return res.send(err);
      }
    });
  });
});

// GET to READ

// List appointment
app.get('/api/appointments', function (req, res) {
  return res.send(queue);
});

// Single appointment
app.get('/api/appointments/:id', function (req, res) {
  return AppointmentModel.findById(req.params.id, function (err, appointment) {
    if (!err) {
      return res.send(appointment);
    } else {
      return res.send(err);
    }
  });
});

// Get next up
app.get('/api/next', function (req, res) {
  console.log(queue[0])
  return res.send(queue[0]);
});

// DELETE to DESTROY

// Bulk destroy all appointment
app.delete('/api/appointments', function (req, res) {
  AppointmentModel.remove(function (err) {
    if (!err) {
      console.log("removed");
      queue = [];
      return res.send(queue);
    } else {
      return res.send(err);
    }
  });
});

// remove a single appointment
app.delete('/api/appointments/:id', function (req, res) {
  var promise = AppointmentModel.findById(req.params.id).exec();
  promise.then(function(appointment) {
    return appointment.remove();
  })
  .then(function(appointment) {
    dequeue_app(appointment.position);
    return res.send(queue);
  })
  .catch(function(err) {
    res.send(err);
  });
});

// Remove next up
app.delete('/api/next', function (req, res) {
  console.log('Removing -->' + queue[0].id)
  dequeue_app(0);
  res.send(queue);
});

// Add Advisor
app.post('/api/advisors', function (req, res) {
  var advisor;
  console.log("POST: ");
  console.log(req.body);
  advisor = new AdvisorModel({
    name: req.body.name,
    status: req.body.status
  });
  advisor.save(function (err) {
    if (!err) {
      console.log("created");
      return res.send(advisor);
    } else {
      console.log(err);
      return res.send(err);
    }
  });
});

// Update Advisor
app.put('/api/advisors/:id', function (req, res) {
  var promise = AdvisorModel.findById(req.params.id).exec();
  promise.then(function(advisor) {
    advisor.name = req.body.name
    advisor.status = req.body.status;
    return advisor.save();
  })
  .then(function(advisor) {
    console.log("Advisor Saved!");
    return res.send(advisor);
  })
  .catch(function(err) {
    console.log(err);
    return res.send(err);
  })
});

// Update Advisor Status
app.put('/api/advisors/:id/status', function (req, res) {
  var promise = AdvisorModel.findById(req.params.id).exec();
  promise.then(function(advisor) {
    advisor.status = req.body.status;
    return advisor.save();
  })
  .then(function(advisor) {
    console.log("Advisor Updated!");
    return res.send(advisor);
  })
  .catch(function(err) {
    console.log(err);
    return res.send(err);
  })
});

// Get Advisors
app.get('/api/advisors', function (req, res) {
 return AdvisorModel.find(function (err, advisors) {
    if (!err) {
      console.log("Getting Advisors");
      return res.send(advisors);
    } else {
      console.log(err);
      return res.send(err);
    }
  });
});

// Get Advisor by id
app.get('/api/advisors/:id', function (req, res) {
   return AdvisorModel.findById(req.params.id, function (err, advisor) {
    if (!err) {
      return res.send(advisor);
    } else {
      console.log(err);
      return res.send(err);
    }
  });
})

// Delete Advsior
app.delete('/api/advisors/:id', function (req, res) {
  return AdvisorModel.findById(req.params.id, function (err, advisor) {
    return advisor.remove(function (err) {
      if (!err) {
        console.log("removed");
        return res.send('');
      } else {
        console.log(err);
        return res.send(err);
      }
    });
  });
});

function clientErrorHandler (err, req, res, next) {
  if (req.xhr) {
    res.status(500).send({ error: 'Something failed!' })
  } else {
    next(err)
  }
}

function errorHandler (err, req, res, next) {
  res.status(500)
  res.render('error', { error: err })
}


// launch server
app.listen(4242);
console.log("Listening on 4242...");
