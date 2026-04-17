const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname)); // Serve static files from root

const DATABASE_FILE = path.join(__dirname, 'database.json');

// Serve index.html on the root route
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'index.html'));
});


// Ensure database file exists with correct structure
if (!fs.existsSync(DATABASE_FILE)) {
    fs.writeFileSync(DATABASE_FILE, JSON.stringify({ users: [], appointments: [] }, null, 2));
}

// Helper functions for reading/writing data
const readData = () => {
    try {
        const content = fs.readFileSync(DATABASE_FILE, 'utf8');
        return JSON.parse(content);
    } catch (e) {
        return { users: [], appointments: [] };
    }
};

const writeData = (data) => fs.writeFileSync(DATABASE_FILE, JSON.stringify(data, null, 2));

// Helper to sort by date and time
const sortAppointments = (apts) => {
    return apts.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        if (dateA - dateB !== 0) return dateA - dateB;

        const timeToMin = (t) => {
            if (!t) return 0;
            const parts = t.split(' ');
            if (parts.length < 2) return 0;
            const [time, period] = parts;
            let [h, m] = time.split(':').map(Number);
            if (period === 'PM' && h !== 12) h += 12;
            if (period === 'AM' && h === 12) h = 0;
            return h * 60 + m;
        };
        return timeToMin(a.time) - timeToMin(b.time);
    });
};

// 0. Queue Calculation API
app.get('/api/queue', (req, res) => {
    const db = readData();
    const username = req.query.username; // Get username from query params
    
    // Only include appointments with status = "approved" or "accepted"
    const approved = db.appointments.filter(a => 
        a.status && (a.status.toLowerCase() === 'approved' || a.status.toLowerCase() === 'accepted')
    );
    
    const sortedQueue = sortAppointments(approved);
    
    // If username provided, calculate user's position
    let userQueueInfo = null;
    if (username) {
        const userIndex = sortedQueue.findIndex(a => a.username.toLowerCase() === username.toLowerCase());
        if (userIndex !== -1) {
            const userAppointment = sortedQueue[userIndex];
            const position = userIndex + 1;
            const peopleAhead = position - 1;
            
            // Calculate expected time: appointment time + (people ahead × 10 minutes)
            const parseTime = (t) => {
                if (!t) return 0;
                const parts = t.split(' ');
                if (parts.length < 2) return 0;
                const [time, period] = parts;
                let [h, m] = time.split(':').map(Number);
                if (period === 'PM' && h !== 12) h += 12;
                if (period === 'AM' && h === 12) h = 0;
                return h * 60 + m;
            };
            
            const baseMin = parseTime(userAppointment.time);
            const expectedMin = baseMin + (peopleAhead * 10);
            
            const formatTime = (totalMin) => {
                let h = Math.floor(totalMin / 60) % 24;
                let m = totalMin % 60;
                const p = h >= 12 ? 'PM' : 'AM';
                h = h % 12 || 12;
                return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${p}`;
            };
            
            userQueueInfo = {
                tokenNumber: userAppointment.id.slice(0, 8).toUpperCase(),
                position: position,
                peopleAhead: peopleAhead,
                expectedTime: formatTime(expectedMin),
                appointment: userAppointment,
                lastUpdated: new Date().toISOString()
            };
        }
    }
    
    res.json({
        queue: sortedQueue,
        userInfo: userQueueInfo,
        totalApproved: sortedQueue.length,
        lastUpdated: new Date().toISOString()
    });
});

// 1. User Registration API
app.post('/api/register', (req, res) => {
    const { username, password, role, email } = req.body;
    const db = readData();

    if (db.users.find(u => u.username === username || u.email === email)) {
        return res.status(400).json({ message: 'User already exists with this username or email' });
    }

    const newUser = { username, password, role, email };
    db.users.push(newUser);
    writeData(db);

    res.status(201).json({ message: 'Registration successful' });
});

// 2. User Login API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = readData();

    const user = db.users.find(u => u.username === username && u.password === password);

    if (user) {
        res.json({ message: 'Login successful', role: user.role, username: user.username, email: user.email, mobile: user.mobile });
    } else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
});

// 3. Appointment Booking API
app.post('/api/book', (req, res) => {
    const { username, mobile, service, date, time } = req.body;
    const db = readData();

    const newAppointment = {
        id: uuidv4(),
        username,
        mobile,
        service,
        date,
        time,
        status: 'Pending'
    };

    db.appointments.push(newAppointment);
    writeData(db);

    res.status(201).json({ message: 'Appointment booked successfully', appointment: newAppointment });
});

// 4. Fetch Appointments API (Admin/Officer Dashboard)
app.get('/api/appointments', (req, res) => {
    const db = readData();
    res.json(db.appointments);
});

// 5. Update Appointment Status API
app.patch('/api/appointments/:id', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    let db = readData();

    const index = db.appointments.findIndex(a => a.id === id);
    if (index !== -1) {
        db.appointments[index].status = status;
        writeData(db);
        res.json({ message: `Appointment ${status.toLowerCase()} successfully` });
    } else {
        res.status(404).json({ message: 'Appointment not found' });
    }
});

// 6. Delete Appointment API
app.delete('/api/appointments/:id', (req, res) => {
    const { id } = req.params;
    let db = readData();

    const index = db.appointments.findIndex(a => a.id === id);
    if (index !== -1) {
        db.appointments.splice(index, 1);
        writeData(db);
        res.json({ message: 'Appointment deleted successfully' });
    } else {
        res.status(404).json({ message: 'Appointment not found' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
