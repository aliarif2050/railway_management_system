const express = require('express');
const cors = require('cors');
const db = require('./db');
const app = express();

app.use(cors());
app.use(express.json());

// 1. REGISTER USER
app.post('/api/register', (req, res) => {
    const { name, city, cnic, password } = req.body;
    const sql = "INSERT INTO Client (Name, City, CNIC, Password) VALUES (?, ?, ?, ?)";
    db.query(sql, [name, city, cnic, password], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "User registered successfully!" });
    });
});

// 2. LOGIN USER
app.post('/api/login', (req, res) => {
    const { cnic, password } = req.body;
    const sql = "SELECT * FROM Client WHERE CNIC = ? AND Password = ?";
    db.query(sql, [cnic, password], (err, data) => {
        if (err) return res.status(500).json(err);
        if (data.length > 0) return res.json(data[0]);
        return res.status(401).json("Invalid Credentials");
    });
});

// 3. SEARCH TRAINS (Dynamic - Handles empty search or full search)
app.get('/api/trains', (req, res) => {
    const { source, dest, date } = req.query;

    // 1. Base Query: Get basic details
    let sql = `
        SELECT t.Train_ID, t.Train_Name, ts.Status_ID, ts.AC_Seats_Available,
         ts.Gen_Seats_Available, ts.Fare_AC, ts.Fare_Gen, ts.Journey_Date,
         s1.Station_Name as Source_Station, s2.Station_Name as Dest_Station
        FROM Train t
        JOIN Train_Status ts ON t.Train_ID = ts.Train_ID
        JOIN Station s1 ON t.Source_Station_ID = s1.Station_ID
        JOIN Station s2 ON t.Dest_Station_ID = s2.Station_ID
        WHERE 1=1 `;

    const params = [];

    // 2. Add filters ONLY if they exist
    if (source) {
        sql += ` AND t.Source_Station_ID IN (SELECT Station_ID FROM Station WHERE Station_Name LIKE ?)`;
        params.push(`%${source}%`);
    }

    if (dest) {
        sql += ` AND t.Dest_Station_ID IN (SELECT Station_ID FROM Station WHERE Station_Name LIKE ?)`;
        params.push(`%${dest}%`);
    }

    if (date) {
        sql += ` AND ts.Journey_Date = ?`;
        params.push(date);
    } else {
        // If no date is selected, show only FUTURE trains (optional logic)
        sql += ` AND ts.Journey_Date >= CURDATE()`;
    }

    sql += ` ORDER BY ts.Journey_Date ASC`;

    // 3. Execute
    db.query(sql, params, (err, data) => {
        if (err) return res.status(500).json(err);
        res.json(data);
    });
});

// 4. BOOK TICKET (Transaction)
app.post('/api/book', (req, res) => {
    const { userId, statusId, passengers, seatType } = req.body; // seatType is 'AC' or 'General'
    for (const p of passengers) {
        if (!p.name || !p.age || !p.gender) {
            return res.status(400).json("Error: All passenger fields (Name, Age, Gender) are required.");
        }
    }
    // Step 1: Create Ticket
    const sqlTicket = "INSERT INTO Ticket (User_ID, Status_ID, Status, Booking_Date) VALUES (?, ?, 'Confirmed', NOW())";
    db.query(sqlTicket, [userId, statusId], (err, result) => {
        if (err) return res.status(500).json(err);

        const pnr = result.insertId;

        // Step 2: Add Passengers
        const sqlPassenger = "INSERT INTO Passenger (PNR_No, Name, Age, Gender, Seat_Category) VALUES ?";
        const passengerValues = passengers.map(p => [pnr, p.name, p.age, p.gender, seatType]);

        db.query(sqlPassenger, [passengerValues], (err, result) => {
            if (err) return res.status(500).json(err);

            // Step 3: Update Seat Count
            const colName = seatType === 'AC' ? 'AC_Seats_Available' : 'Gen_Seats_Available';
            const sqlUpdate = `UPDATE Train_Status SET ${colName} = ${colName} - ? WHERE Status_ID = ?`;

            db.query(sqlUpdate, [passengers.length, statusId], (err, result) => {
                if (err) return res.status(500).json(err);
                res.json({ message: "Booking Successful", pnr: pnr });
            });
        });
    });

});

// 5. GET MY BOOKINGS (UPDATED: With Passenger Details)
app.get('/api/my-bookings/:userId', (req, res) => {
    const sql = `
        SELECT 
            tic.PNR_No, tic.Status, tic.Booking_Date,
            t.Train_Name, ts.Journey_Date,
            ts.Fare_AC, ts.Fare_Gen,
            s1.Station_Name as Source, s2.Station_Name as Dest,
            p.Passenger_ID, p.Name as PassengerName, p.Age, p.Gender, p.Seat_Category , p.discount
        FROM Ticket tic
        JOIN Train_Status ts ON tic.Status_ID = ts.Status_ID
        JOIN Train t ON ts.Train_ID = t.Train_ID
        JOIN Station s1 ON t.Source_Station_ID = s1.Station_ID
        JOIN Station s2 ON t.Dest_Station_ID = s2.Station_ID
        JOIN Passenger p ON tic.PNR_No = p.PNR_No
        WHERE tic.User_ID = ? 
        ORDER BY tic.Booking_Date DESC`;

    db.query(sql, [req.params.userId], (err, rows) => {
        if (err) return res.status(500).json(err);

        // Grouping the flat SQL rows into nested JSON objects
        const bookingsMap = {};

        rows.forEach(row => {
            if (!bookingsMap[row.PNR_No]) {
                bookingsMap[row.PNR_No] = {
                    pnr: row.PNR_No,
                    status: row.Status,
                    date: row.Journey_Date,
                    train: row.Train_Name,
                    source: row.Source,
                    dest: row.Dest,
                    bookingTime: row.Booking_Date,
                    discount: row.discount,
                    totalfare: 0,
                    passengers: [],
                };
            }

            const priceString = row.Seat_Category === 'AC' ? row.Fare_AC : row.Fare_Gen;
            const discount = row.discount === 0.0 ? 0 : (priceString * row.discount);
            const priceStringWithDiscount = priceString - discount;
            const price = parseFloat(priceStringWithDiscount);
            bookingsMap[row.PNR_No].totalfare += price;
            bookingsMap[row.PNR_No].passengers.push({
                passengerId: row.Passenger_ID,
                name: row.PassengerName,
                age: row.Age,
                gender: row.Gender,
                seat: row.Seat_Category,
                discount: row.discount,
            });
        });

        // Convert object back to array
        res.json(Object.values(bookingsMap));
    });
});

// Cancel Passenger
app.post('/api/cancel-passenger', (req, res) => {
    const { passengerId, totalfare , discount} = req.body;
    const getPassengerSql = "SELECT PNR_No, Seat_Category FROM Passenger WHERE Passenger_ID = ?";
    db.query(getPassengerSql, [passengerId], (err, results) => {
        if (err) return res.status(500).json(err);
        if (results.length === 0) return res.status(404).json("Passenger not found");
        const { PNR_No, Seat_Category } = results[0];
        const colName = Seat_Category === 'AC' ? 'AC_Seats_Available' : 'Gen_Seats_Available';
        const getStatus = `Select t.Status_ID from ticket t join passenger p on t.PNR_No = p.PNR_No where p.Passenger_ID = ? `;
        db.query(getStatus, [passengerId], (err, statusResults) => {
            if (err) return res.status(500).json(err);
            const Status_ID = statusResults[0].Status_ID;
            const updateSeatsSql = `UPDATE Train_Status SET ${colName} = ${colName} + ? WHERE Status_ID = ?`;
            db.query(updateSeatsSql, [1, Status_ID], (err, result) => {
                if (err) return res.status(500).json(err);
                const deletePassengerSql = `delete from passenger where Passenger_ID = ?`;
                db.query(deletePassengerSql, [passengerId], (err, result) => {
                    if (err) return res.status(500).json(err);
                    const updateFare = `select ts.Fare_AC, ts.Fare_Gen from Train_Status ts where ts.Status_ID = ?`;
                    db.query(updateFare, [Status_ID], (err, fareResults) => {
                        if (err) return res.status(500).json(err);
                        const fareAC = fareResults[0].Fare_AC;
                        const fareGen = fareResults[0].Fare_Gen;
                        const seatFare = Seat_Category === 'AC' ? fareAC : fareGen;
                        const discountAmount = discount === 0.0 ? 0 : (seatFare * discount);
                        const finalSeatFare = seatFare - discountAmount;                        
                        const newTotalFare = totalfare - finalSeatFare;
                        res.json({ message: "Passenger Cancelled Successfully", newTotalFare });
                    });
                });
            });
        });
    });
});

// 6. CANCEL TICKET
app.post('/api/cancel', (req, res) => {
    const { pnr } = req.body;

    // Step 1: Get ticket details to know how many seats to restore
    const getDetailsSql = `
        SELECT t.Status_ID, p.Seat_Category, COUNT(p.Passenger_ID) as PaxCount 
        FROM Ticket t 
        JOIN Passenger p ON t.PNR_No = p.PNR_No 
        WHERE t.PNR_No = ? AND t.Status != 'Cancelled'
        GROUP BY t.Status_ID, p.Seat_Category`;

    db.query(getDetailsSql, [pnr], (err, results) => {
        if (err) return res.status(500).json(err);
        if (results.length === 0) return res.status(404).json("Ticket not found or already cancelled");

        const { Status_ID, Seat_Category, PaxCount } = results[0];

        // Step 2: Restore seats in Train_Status
        const colName = Seat_Category === 'AC' ? 'AC_Seats_Available' : 'Gen_Seats_Available';
        const updateSeatsSql = `UPDATE Train_Status SET ${colName} = ${colName} + ? WHERE Status_ID = ?`;

        db.query(updateSeatsSql, [PaxCount, Status_ID], (err, result) => {
            if (err) return res.status(500).json(err);

            // Step 3: Mark Ticket as Cancelled
            const cancelTicketSql = "UPDATE Ticket SET Status = 'Cancelled' WHERE PNR_No = ?";
            db.query(cancelTicketSql, [pnr], (err, result) => {
                if (err) return res.status(500).json(err);
                res.json({ message: "Ticket Cancelled Successfully" });
            });
        });
    });
});
app.listen(5000, () => {
    console.log("Server running on port 5000");
});