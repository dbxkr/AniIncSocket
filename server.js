import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";

const rooms = new Map();

const wss = new WebSocketServer({ port: 4000 });
let players = [];
let readyCount = 0;
let gameState = "waiting";
let ladder = [];
let results = [];
let countdowns = {};
let dept = [];
let gameOver = false; // 게임 종료 상태 추가

wss.on("connection", (ws) => {
  const clientId = uuidv4();
  const player = {
    clientId,
    ws,
    ready: false,
    nickname: `Player${players.length + 1}`,
    grade: "Gold",
    points: 1000,
    score: 0, // 스페이스바 횟수를 위한 필드 추가
  };
  players.push(player);

  // if (players.length > 4) {
  //   ws.send(JSON.stringify({ type: "roomFull" }));
  //   ws.close();
  //   return;
  // }

  // 클라이언트 초기화 메시지 전송
  ws.send(
    JSON.stringify({ type: "init", clientId, playerNum: players.length })
  );

  // broadcastPlayers();

  ws.on("message", (message) => {
    const parsedMessage = JSON.parse(message.toString()); // Buffer를 문자열로 변환하여 JSON으로 파싱
    console.log("Received message >> ", parsedMessage);

    switch (parsedMessage.type) {
      case "join":
        handleJoin(ws, clientId, parsedMessage.room_id);
        break;
      case "finishPath":
        handleFinishPath(parsedMessage);
        break;
      case "count":
        handleSpaceBarPress(parsedMessage); // 스페이스바 이벤트 처리 추가
        break;
      case "turn":
        turn(parsedMessage);
        break;
      case "skip":
        skip(parsedMessage);
        break;
      case "buySell":
        buySell(parsedMessage);
        break;
      case "playerInfo":
        setPlayer(parsedMessage, ws);
        break;
      case "gameChat":
        gameChat(parsedMessage);
        break;
      case "shortSelling":
        shortSell(parsedMessage);
        break;
      case "lottery":
        lottery(parsedMessage);
        break;
      case "gameover":
        gameover(parsedMessage);
        break;
      default:
        broadcast(parsedMessage);
    }
  });

  ws.on("close", () => {
    for (const [roomId, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex((p) => p.ws === ws);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        broadcastPlayers(roomId);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        }
        break;
      }
    }
  });
});

function handleJoin(ws, clientId, roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      players: [],
      gameState: "waiting",
      ladder: [],
      results: [],
      totalParticipants: 0,
      winner: null,
      rewards: [],
    });
  }

  const room = rooms.get(roomId);

  axios
    .get(`http://localhost:8080/api/user/game/ladder/participants/${roomId}`)
    .then((res) => {
      room.totalParticipants = res.data.length;
      // players.filter(
      //   (player) => player.roomid === roomId
      // ).length;

      if (room.players.length < room.totalParticipants) {
        const newPlayer = {
          clientId,
          userNum: res.data[room.players.length].users.userNum,
          ws,
          nickname: res.data[room.players.length].users.userNickname,
          grade: res.data[room.players.length].users.userGrade,
          userPicture: res.data[room.players.length].users.userPicture,
        };

        room.players.push(newPlayer);
        broadcastPlayers(roomId);

        ws.send(
          JSON.stringify({
            type: "gameState",
            state: room.gameState,
            ladder: room.ladder,
            players: room.players.map((p) => p.clientId),
            totalParticipants: room.totalParticipants,
            currentParticipants: room.players.length,
          })
        );

        if (room.players.length > 0) {
          startCountdown(roomId);
        }
      } else {
        ws.send(JSON.stringify({ type: "roomFull" }));
      }
    })
    .catch((error) => console.log(error));
}

function startCountdown(roomId) {
  const room = rooms.get(roomId);
  room.gameState = "countdown";
  let countdown = 5;
  const countdownInterval = setInterval(() => {
    broadcastToRoom(
      roomId,
      JSON.stringify({ type: "countdown", count: countdown })
    );
    countdown--;
    if (countdown < 0) {
      clearInterval(countdownInterval);
      startGame(roomId);
    }
  }, 1000);
}

function startGame(roomId) {
  const room = rooms.get(roomId);
  room.gameState = "running";
  room.ladder = createLadder(room.players.length);
  room.rewards = createRandomRewards(room.players.length);
  broadcastToRoom(
    roomId,
    JSON.stringify({
      type: "startGame",
      ladder: room.ladder,
      players: room.players.map((p) => p.clientId),
      rewards: room.rewards,
    })
  );
}

function handleFinishPath(message) {
  for (const [roomId, room] of rooms.entries()) {
    const playerIndex = room.players.findIndex(
      (p) => p.clientId === message.clientId
    );
    if (playerIndex !== -1) {
      const result = {
        clientId: message.clientId,
        result: message.result,
        nickname: room.players[playerIndex].nickname,
      };
      room.results.push(result);
      if (room.rewards[message.result] === "win") {
        room.winner = room.players[playerIndex];
      }
      if (room.results.length === room.players.length) {
        broadcastToRoom(
          roomId,
          JSON.stringify({
            type: "gameEnded",
            results: room.results,
            winner: room.winner,
          })
        );
        room.gameState = "waiting";
        room.results = [];
        room.ladder = [];
        room.winner = null;
        room.rewards = [];
      }
      break;
    }
  }
}

function broadcastPlayers(roomId) {
  const room = rooms.get(roomId);
  const playerList = room.players.map((p) => ({
    clientId: p.clientId,
    userNum: p.userNum,
    nickname: p.nickname,
    grade: p.grade,
    userPicture: p.userPicture,
  }));
  broadcastToRoom(
    roomId,
    JSON.stringify({
      type: "players",
      players: playerList,
      totalParticipants: room.totalParticipants,
      currentParticipants: room.players.length,
    })
  );
}

function broadcastToRoom(roomId, message) {
  const room = rooms.get(roomId);
  room.players.forEach((player) => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(message);
    }
  });
}

function createLadder(numPlayers) {
  const maxHorizontalLines = Math.floor(Math.random() * 10) * 2 + 2;
  return Array.from({ length: maxHorizontalLines }, () =>
    Array(numPlayers - 1).fill(false)
  ).map((row) => {
    const col = Math.floor(Math.random() * (numPlayers - 1));
    row[col] = true;
    return row;
  });
}

function createRandomRewards(numPlayers) {
  const rewards = new Array(numPlayers).fill("bomb");
  const winIndex = Math.floor(Math.random() * numPlayers);
  rewards[winIndex] = "win";
  return rewards;
}

// 스페이스바 이벤트 핸들러 수정
function handleSpaceBarPress(message) {
  const player = players.find((p) => p.clientId === message.clientId);
  if (player) {
    player.score += 1;

    console.log(`Player ${player.nickname} score: ${player.score}`);

    if (!gameOver && player.score >= 10) {
      gameOver = true;
      console.log(`Player ${player.nickname} is the winner!`);

      // 첫 번째로 10번을 달성한 플레이어에게만 1등 메시지 전송
      player.ws.send(
        JSON.stringify({
          type: "gameOver",
          message: "1등입니다! 게임이 종료되었습니다.",
          isWinner: true, // 1등 여부를 나타내는 필드 추가
        })
      );

      // 나머지 플레이어들에게 게임 종료를 알림
      players.forEach((p) => {
        if (p.clientId !== player.clientId) {
          p.ws.send(
            JSON.stringify({
              type: "gameOver",
              message: "게임이 종료되었습니다.",
            })
          );
        }
      });
    }

    // 업데이트된 점수를 모든 클라이언트에게 전송
    broadcast(
      JSON.stringify({
        type: "count",
        clientId: player.clientId,
        count: player.score,
        playerNum: players.indexOf(player) + 1, // 플레이어 번호 추가
      })
    );
  }
}

function broadcast(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        typeof message === "string" ? message : JSON.stringify(message)
      );
    }
  });
}

//게임 관련된 메세지 통합처리
function gameRoomMessage(message, roomid, type) {
  const newMessage = {
    ...message,
    type: type,
  };
  players
    .filter((player) => player.roomid === roomid)
    .forEach((player) => {
      // console.log(
      //   `WebSocket state: ${player.ws.readyState} >> `,
      //   player.clientId
      // );
      player.ws.send(JSON.stringify(newMessage));
    });
}

function setPlayer(message, ws) {
  const existingPlayer = players.find(
    (player) =>
      player.roomid === message.roomid && player.usernum === message.usernum
  );

  if (existingPlayer) {
    console.log("Player already exists:", existingPlayer.nickname);
    existingPlayer.ws = ws; // 기존 플레이어의 WebSocket 업데이트
  } else {
    const clientId = uuidv4();
    const player = {
      clientId,
      ws,
      ready: false,
      roomid: message.roomid,
      nickname: message.nickname,
      usernum: message.usernum,
      grade: "Gold",
      points: 1000,
      dept: [],
    };
    console.log("player >>> ", player.nickname);
    players.push(player);
  }

  // if (message.turn < 12) {
  turn(message);
  // }
}

//게임-채팅
function gameChat(message) {
  const newMessage = {
    type: "message",
    sender: message.nickname,
    content: message.content,
    usernum: message.usernum,
  };
  gameRoomMessage(newMessage, message.roomid, "message");
}

//게임-매도/매수
function buySell(message) {
  const newMessage = {
    type: "buySell",
    sender: message.nickname,
    stockId: message.stockId,
    amount: message.amount,
    usernum: message.usernum,
    action: message.action,
  };
  gameRoomMessage(newMessage, message.roomid, "buySell");
}

//게임-로또
function lottery(message) {
  const newMessage = {
    type: "game",
    content: message.content,
  };
  gameRoomMessage(newMessage, message.roomid, "game");
}

function sendNext(message, cont) {
  const roomPlayers = players.filter(
    (player) => player.roomid === message.roomid
  );

  if (roomPlayers.length > 0) {
    const randomPlayer =
      roomPlayers[Math.floor(Math.random() * roomPlayers.length)];
    // console.log("player in charge", randomPlayer);
    const newMessage = {
      type: "turn",
      turn: message.turn,
      content: cont,
      incharge: randomPlayer.usernum, // 랜덤하게 선택된 플레이어의 playernum 추가
    };
    gameRoomMessage(newMessage, message.roomid, "turn");
  } else {
    console.log("No players in the room.");
  }
}

//게임 - 카운트다운
function turn(message) {
  const roomid = message.roomid;

  if (countdowns[roomid]) {
    console.log("A countdown is already running for this room.");
    return;
  }

  let remainingSeconds = 0;
  countdowns[roomid] = setInterval(() => {
    if (remainingSeconds < 180) {
      if (remainingSeconds === 10) {
        notifyAndRemoveDept(roomid);
      }
      gameRoomMessage(
        { type: "timer", time: remainingSeconds },
        roomid,
        "timer"
      );
      remainingSeconds++;
    } else {
      clearInterval(countdowns[roomid]);
      delete countdowns[roomid];
      sendNext(message, "turn");
    }
  }, 1000); // 1 second
}

// 조건에 맞는 플레이어에게 메시지를 보내고 해당 원소를 dept에서 지우는 함수
function notifyAndRemoveDept(roomid) {
  dept = dept.filter((entry) => {
    if (entry.roomid === roomid) {
      const player = players.find(
        (player) => player.roomid === roomid && player.usernum === entry.usernum
      );
      // console.log("빚쟁이>>", player);

      if (player) {
        // console.log(
        //   `WebSocket state: ${player.ws.readyState} >> `,
        //   player.clientId
        // );
        if (player.ws.readyState === WebSocket.OPEN) {
          player.ws.send(
            JSON.stringify({
              type: "debt",
              usernum: entry.usernum,
              stock: entry.stock,
              amount: entry.amount,
            })
          );
          console.log("Message sent to player:", player.nickname);
          return false; // 해당 원소를 dept에서 제거
        } else {
          console.log("WebSocket is not open for player:", player.nickname);
        }
      } else {
        console.log("No player found with matching roomid and usernum");
      }
    }
    return true;
  });
}

//게임 - 타이머 ㅈ까
function skip(message) {
  const roomid = message.roomid;
  if (countdowns[roomid]) {
    clearTimeout(countdowns[roomid]);
    delete countdowns[roomid];
    sendNext(message, "skip");
  }
}

//게임-오버
function gameover(message) {
  // console.log("게임 오버", message);

  // 데이터를 total 값 기준으로 내림차순 정렬
  const sortedData = message.data.sort((a, b) => b.total - a.total);

  // 순위를 매기기 위한 변수
  let rank = 1;
  let previousTotal = sortedData[0].total;

  // 순위를 매긴 데이터를 저장할 배열
  const rankedData = sortedData.map((item, index) => {
    if (item.total !== previousTotal) {
      rank = index + 1;
    }
    previousTotal = item.total;
    return { ...item, rank };
  });

  console.log("순위가 매겨진 데이터:", rankedData);
  const newMessage = {
    type: "gameover",
    content: rankedData,
  };
  gameRoomMessage(newMessage, message.roomid, "gameover");
}

//게임 - 빚
function shortSell(message) {
  dept.push({
    roomid: message.roomid,
    usernum: message.usernum,
    stock: message.stockid,
    amount: message.amount,
  });
}
console.log("WebSocket server is running on ws://localhost:4000");
