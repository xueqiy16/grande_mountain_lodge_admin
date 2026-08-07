// Real-time stay cost + tax math shared by the Walk-In and Check-In modals.
// Taxes apply strictly to the base room charge (nightly rate × nights).
// Alberta Tourism Levy is exempt for long stays of 28+ nights.
export const computeStayCost = (nightlyRate, checkIn, checkOut) => {
  const rate = Number(nightlyRate) || 0;

  let numberOfNights = 0;
  if (checkIn && checkOut) {
    const start = new Date(checkIn + 'T00:00:00');
    const end = new Date(checkOut + 'T00:00:00');
    const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    numberOfNights = diff > 0 ? diff : 0;
  }

  const baseRoomCharge = rate * numberOfNights;
  const gst = Math.round(baseRoomCharge * 0.05 * 100) / 100;
  const tourismLevy = numberOfNights < 28 ? Math.round(baseRoomCharge * 0.06 * 100) / 100 : 0;
  const totalStayAmount = baseRoomCharge + gst + tourismLevy;

  return { nightlyRate: rate, numberOfNights, baseRoomCharge, gst, tourismLevy, totalStayAmount };
};
