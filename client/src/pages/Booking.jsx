import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';

function Booking({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { train, type } = location.state || {};
  
  const [passengers, setPassengers] = useState([{ name: '', age: '', gender: '' }]);

  const addPassenger = () => {
    setPassengers([...passengers, { name: '', age: '', gender: '' }]);
  };

  const handleChange = (index, field, value) => {
    const newPassengers = [...passengers];
    newPassengers[index][field] = value;
    setPassengers(newPassengers);
  };

  const handleSubmit = async () => {
    try {
      await axios.post('http://localhost:5000/api/book', {
        userId: user.User_ID,
        statusId: train.Status_ID,
        passengers: passengers,
        seatType: type
      });
      alert('Booking Successful!');
      navigate('/my-bookings');
    } catch (err) {
      alert('Booking Failed, please try again and fill all fields, or check seat availability or check Date of Journey.');
    }
  };

  if (!train) return <div>Invalid Access</div>;

  return (
    <div className="max-w-2xl mx-auto bg-white p-6 rounded shadow mt-10">
      <h2 className="text-2xl font-bold mb-4">Book Ticket: {train.Train_Name} ({type})</h2>
      
      {passengers.map((p, index) => (
        <div key={index} className="flex gap-2 mb-2">
          <input placeholder="Name" className="border p-2 flex-1 rounded" 
             onChange={(e) => handleChange(index, 'name', e.target.value)} />
          <input placeholder="Age" type="number" className="border p-2 w-20 rounded" 
             onChange={(e) => handleChange(index, 'age', e.target.value)} />
          <select className="border p-2 rounded" onChange={(e) => handleChange(index, 'gender', e.target.value)}>
             <option value="">Gender</option>
             <option value="M">Male</option>
             <option value="F">Female</option>
          </select>
        </div>
      ))}
      
      <button onClick={addPassenger} className="text-blue-600 text-sm mb-4">+ Add Passenger</button>
      
      <div className="border-t pt-4">
        <button onClick={handleSubmit} className="w-full bg-blue-600 text-white py-2 rounded font-bold hover:bg-blue-700">
          Confirm Booking
        </button>
      </div>
    </div>
  );
}

export default Booking;