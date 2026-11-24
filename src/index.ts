import express from "express";
import bodyParser from "body-parser";

export const app = express();

app.use(bodyParser({}));

interface Balances {
  [key: string]: number;
}

interface User {
  id: string;
  balances: Balances;
};

interface Order {
  userId: string;
  price: number;
  quantity: number;
}

export const TICKER = "GOOGLE";

const users: User[] = [{
  id: "1",
  balances: {
    "GOOGLE": 10,
    "USD": 50000
  }
}, {
  id: "2",
  balances: {
    "GOOGLE": 10,
    "USD": 50000
  }
}];

const bids: Order[] = [];
const asks: Order[] = [];

// Place a limit order
app.post("/order", (req: any, res: any) => {
  const side: string = req.body.side;
  const type: string = req.body.type || "limit";
  const price: number = req.body.price;
  const quantity: number = req.body.quantity;
  const userId: string = req.body.userId;
  const isMarket = type === "market";

  const remainingQty = fillOrders(side, price, quantity, userId, isMarket);

  if (remainingQty === 0) {
    res.json({ filledQuantity: quantity });
    return;
  }

  if (isMarket) {
    res.json({ filledQuantity: quantity - remainingQty });
    return;
  }

  if (side === "bid") {
    bids.push({
      userId,
      price,
      quantity: remainingQty
    });
    bids.sort((a, b) => a.price < b.price ? -1 : 1);
  } else {
    asks.push({
      userId,
      price,
      quantity: remainingQty
    })
    asks.sort((a, b) => a.price < b.price ? 1 : -1);
  }

  res.json({
    filledQuantity: quantity - remainingQty,
  })
})

app.get("/depth", (req: any, res: any) => {
  const depth: {
    [price: string]: {
      type: "bid" | "ask",
      quantity: number,
    }
  } = {};

  for (let i = 0; i < bids.length; i++) {
    if (!depth[bids[i].price]) {
      depth[bids[i].price] = {
        quantity: bids[i].quantity,
        type: "bid"
      };
    } else {
      depth[bids[i].price].quantity += bids[i].quantity;
    }
  }

  for (let i = 0; i < asks.length; i++) {
    if (!depth[asks[i].price]) {
      depth[asks[i].price] = {
        quantity: asks[i].quantity,
        type: "ask"
      }
    } else {
      depth[asks[i].price].quantity += asks[i].quantity;
    }
  }

  res.json({
    depth
  })
})

app.get("/balance/:userId", (req, res) => {
  const userId = req.params.userId;
  const user = users.find(x => x.id === userId);
  if (!user) {
    return res.json({
      USD: 0,
      [TICKER]: 0
    })
  }
  res.json({ balances: user.balances });
})

function getQuote(side: string, quantity: number): number {
  const orders = side === "bid" ? asks : bids;
  let remainingQuantity = quantity;
  let quote = 0;

  for (let i = orders.length - 1; i >= 0 && remainingQuantity > 0; i--) {
    const filledQuantity = Math.min(orders[i].quantity, remainingQuantity);
    quote += filledQuantity * orders[i].price;
    remainingQuantity -= filledQuantity;
  }

  return quote;
}

function quoteHandler(req: any, res: any) {
  const body = req.body || {};
  const side = body.side || req.query.side;
  const quantity = Number(body.quantity || req.query.quantity);

  if ((side !== "bid" && side !== "ask") || !Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ quote: 0 });
  }

  res.json({ quote: getQuote(side, quantity) });
}

app.post("/quote", quoteHandler);
app.get("/quote", quoteHandler);

function flipBalance(userId1: string, userId2: string, quantity: number, price: number) {
  let user1 = users.find(x => x.id === userId1);
  let user2 = users.find(x => x.id === userId2);
  if (!user1 || !user2) {
    return;
  }
  user1.balances[TICKER] -= quantity;
  user2.balances[TICKER] += quantity;
  user1.balances["USD"] += (quantity * price);
  user2.balances["USD"] -= (quantity * price);
}

function fillOrders(side: string, price: number, quantity: number, userId: string, isMarket = false): number {
  let remainingQuantity = quantity;
  if (side === "bid") {
    for (let i = asks.length - 1; i >= 0 && remainingQuantity > 0; i--) {
      if (!isMarket && asks[i].price > price) {
        continue;
      }
      const filledQuantity = Math.min(asks[i].quantity, remainingQuantity);
      asks[i].quantity -= filledQuantity;
      flipBalance(asks[i].userId, userId, filledQuantity, asks[i].price);
      remainingQuantity -= filledQuantity;
      if (asks[i].quantity === 0) {
        asks.splice(i, 1);
      }
    }
  } else {
    for (let i = bids.length - 1; i >= 0 && remainingQuantity > 0; i--) {
      if (!isMarket && bids[i].price < price) {
        continue;
      }
      const filledQuantity = Math.min(bids[i].quantity, remainingQuantity);
      bids[i].quantity -= filledQuantity;
      flipBalance(userId, bids[i].userId, filledQuantity, bids[i].price);
      remainingQuantity -= filledQuantity;
      if (bids[i].quantity === 0) {
        bids.splice(i, 1);
      }
    }
  }

  return remainingQuantity;
}

