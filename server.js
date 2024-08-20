import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";

const wss = new WebSocketServer({ port: 4000 });
let players = []; // 현재 연결된 플레이어들을 저장하는 배열
let readyCount = 0; // 현재 레디 상태인 플레이어 수
let gameState = "waiting"; // 게임 상태 (대기 중, 진행 중 등)
let ladder = []; // 게임에서 사용할 사다리 데이터
let results = []; // 게임 결과를 저장할 배열
let gameOver = false; // 게임 종료 여부를 나타내는 플래그
let countdownInterval; // 카운트다운 타이머를 저장할 변수

let countdowns = {};
let fake = {};
let dept = [];

// 클라이언트가 서버에 연결될 때 실행되는 함수
wss.on("connection", (ws) => {
  const clientId = uuidv4(); // 클라이언트 ID 생성
  ws.on("message", (message) => {
    const parsedMessage = JSON.parse(message.toString());
    console.log("Received message:", parsedMessage);

    switch (parsedMessage.type) {
      case "login":
        handleLogin(parsedMessage, ws, clientId);
        break;
      case "ready":
        handleReadyMessage(parsedMessage);
        break;
      case "chat":
        broadcast(parsedMessage);
        break;
      case "count":
        handleSpaceBarPress(parsedMessage);
        break;
      case "finishPath":
        handleFinishPath(parsedMessage);
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
      case "fakenews":
        fakeNews(parsedMessage);
        break;
      case "news":
        news(parsedMessage);
        break;
      case "gameover":
        gameover(parsedMessage);
        break;
      case "join":
        handleJoin(ws, clientId, parsedMessage.room_id);
        break;
      default:
        console.log("Unknown message type:", parsedMessage.type);
    }
  });

  // 플레이어가 연결을 끊었을 때 실행되는 함수
  ws.on("close", () => {
    players = players.filter((p) => p.ws !== ws); // 연결 끊은 플레이어 제거
    readyCount = players.filter((p) => p.ready).length; // 레디 상태 갱신
    broadcastPlayers(); // 모든 클라이언트에게 업데이트된 상태 전송
  });
});

// 플레이어 로그인 처리 함수
function handleLogin(parsedMessage, ws, clientId) {
  const player = {
    clientId: parsedMessage.clientId || clientId, // 플레이어 ID 생성 또는 수신된 ID 사용
    ws, // WebSocket 연결 객체
    ready: false,
    nickname: parsedMessage.userNickname || `Player${players.length + 1}`, // 닉네임이 없으면 기본값으로 Player 사용
    grade: parsedMessage.userGrade,
    points: parsedMessage.userPoint,
    score: 0,
    picture: parsedMessage.userPicture, // 여기서 오타를 수정
  };
  players.push(player); // 새로운 플레이어를 players 배열에 추가

  console.log("Player logged in:", player);

  // 최대 플레이어 수를 초과하면 연결 종료
  // if (players.length > 4) {
  //   ws.send(JSON.stringify({ type: "roomFull" }));
  //   ws.close();
  //   return;
  // }

  // 초기화 메시지를 클라이언트에 전송
  ws.send(
    JSON.stringify({
      type: "init",
      clientId: player.clientId,
      playerNum: players.length,
    })
  );

  // 전체 플레이어 상태를 클라이언트에 브로드캐스트
  broadcastPlayers();
}

// 플레이어 레디 상태 처리 함수
// 플레이어 레디 상태 처리 함수
function handleReadyMessage(message) {
  if (!message.clientId) {
    console.log("Received undefined clientId. Message ignored:", message);
    return; // clientId가 undefined인 경우 처리를 중단
  }

  const player = players.find((p) => p.clientId === message.clientId);
  if (player) {
    player.ready = message.ready;
    console.log(
      `플레이어 ${player.nickname}의 레디 상태가 ${
        player.ready ? "레디됨" : "레디 취소됨"
      }로 설정되었습니다.`
    );
    readyCount = players.filter((p) => p.ready).length;
    broadcastPlayers();

    // 모든 플레이어가 준비 완료되었을 때만 카운트다운 시작
    if (readyCount === players.length && players.length > 1) {
      startCountdown();
    } else {
      // 준비 취소된 경우 카운트다운 중지 및 모든 플레이어에게 알림
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      broadcast({ type: "countdownCanceled" }); // 클라이언트에 카운트다운이 취소되었음을 알림
      console.log("카운트다운이 중지되었습니다.");
    }
  } else {
    console.log("플레이어를 찾을 수 없습니다:", message.clientId);
  }
}

// 사다리 게임에 입장하면 해당 방 정보를 불러옴.
const rooms = new Map();
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
        broadcastPlayersToRoom(roomId);

        ws.send(
          JSON.stringify({
            type: "gameState",
            state: room.gameState,
            ladder: room.ladder,
            players: room.players.map((p) => ({
              clientId: p.clientId,
              nickname: p.nickname,
              userPicture: p.userPicture,
            })),
            totalParticipants: room.totalParticipants,
            currentParticipants: room.players.length,
          })
        );

        if (room.players.length === room.totalParticipants) {
          startCountdown(roomId);
        }
      }
    })
    .catch((error) => console.log(error));
}

function broadcastPlayersToRoom(roomId) {
  const room = rooms.get(roomId);
  const playerList = room.players.map((p) => ({
    clientId: p.clientId,
    nickname: p.nickname,
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

// 사다리 실행 전 카운트다운 시작 함수
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

// 사다리 생성 함수 (게임 시작 시 호출됨)
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

// 게임 시작 함수
function startGame(roomId) {
  const room = rooms.get(roomId);
  room.gameState = "running";
  room.ladder = createLadder(room.players.length);
  room.rewards = createRandomRewards(room.players.length);
  room.results = []; // 결과 초기화
  room.winner = null; // 우승자 초기화
  console.log("Game starting for room:", roomId);
  console.log("Ladder:", room.ladder);
  console.log("Rewards:", room.rewards);
  broadcastToRoom(
    roomId,
    JSON.stringify({
      type: "startGame",
      ladder: room.ladder,
      players: room.players.map((p) => ({
        clientId: p.clientId,
        nickname: p.nickname,
        userPicture: p.userPicture,
      })),
      rewards: room.rewards,
    })
  );
}

function createRandomRewards(numPlayers) {
  const rewards = new Array(numPlayers).fill("bomb");
  const winIndex = Math.floor(Math.random() * numPlayers);
  rewards[winIndex] = "win";
  return rewards;
}

// 게임 종료 후 결과 처리 함수
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
        room.winner = {
          clientId: room.players[playerIndex].clientId,
          nickname: room.players[playerIndex].nickname,
          userNum: room.players[playerIndex].userNum,
        };
      }
      console.log(
        `Player ${result.nickname} finished path. Result: ${message.result}`
      );
      console.log(`Current results: ${JSON.stringify(room.results)}`);
      if (room.results.length === room.players.length) {
        console.log("Game ended. Sending results to all players.");
        console.log(`Winner: ${JSON.stringify(room.winner)}`);
        broadcastToRoom(
          roomId,
          JSON.stringify({
            type: "gameEnded",
            results: room.results,
            winner: room.winner,
            rewards: room.rewards,
          })
        );
        room.gameState = "ended";
      }
      break;
    }
  }
}

function broadcastToRoom(roomId, message) {
  const room = rooms.get(roomId);
  room.players.forEach((player) => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(message);
    }
  });
}

// 게임 중 점수 업데이트 함수 (스페이스바 누를 때 호출됨)
function handleSpaceBarPress(message) {
  const player = players.find((p) => p.clientId === message.clientId);
  if (player) {
    player.score += 1;

    console.log(`Player ${player.nickname} score: ${player.score}`);

    if (!gameOver && player.score >= 10) {
      gameOver = true;
      console.log(`Player ${player.nickname} is the winner!`);

      player.ws.send(
        JSON.stringify({
          type: "gameOver", // 게임 종료 메시지 전송
          message: "1등입니다! 게임이 종료되었습니다.",
          isWinner: true,
        })
      );

      players.forEach((p) => {
        if (p.clientId !== player.clientId) {
          p.ws.send(
            JSON.stringify({
              type: "gameOver", // 다른 플레이어들에게도 게임 종료 알림
              message: "게임이 종료되었습니다.",
            })
          );
        }
      });
    }

    broadcast(
      JSON.stringify({
        type: "count", // 현재 점수 업데이트
        clientId: player.clientId,
        count: player.score,
        playerNum: players.indexOf(player) + 1,
      })
    );
  }
}

// 플레이어 정보 브로드캐스트 함수
function broadcastPlayers() {
  const playerList = players.map((p) => ({
    clientId: p.clientId,
    nickname: p.nickname,
    grade: p.grade,
    points: p.points,
    ready: p.ready, // 레디 상태 포함
    score: p.score,
    picture: p.picture, // 수정된 부분: 올바른 필드명을 사용하여 데이터를 전송
  }));

  console.log("플레이어 정보 뿌리는 코드임 >>> ", playerList);

  broadcast(JSON.stringify({ type: "players", players: playerList }));
}

// 메시지 브로드캐스트 함수
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

//게임-가짜 뉴스
function fakeNews(message) {
  const newMessage = {
    type: "game",
    content: message.content,
  };
  const roomId = message.roomid;
  if (!fake[roomId]) {
    fake[roomId] = [];
  }

  fake[roomId].push({
    turn: message.turn,
    stock: message.stockId,
    describe: message.describe,
  });
  // console.log(fake[roomId]);
  gameRoomMessage(newMessage, message.roomid, "game");
}

function news(message) {
  const roomId = message.roomid;
  const stockId = message.stock;
  const turn = message.turn;
  let describe = "no";

  // console.log("fake", fake);
  if (fake[roomId]) {
    const fakeStocks = fake[roomId].filter(
      (item) => item.stock === stockId && item.turn === turn
    );

    // console.log("fakeStocks", fakeStocks);

    if (fakeStocks.length > 0) {
      const randomIndex = Math.floor(Math.random() * fakeStocks.length);
      describe = fakeStocks[randomIndex].describe;
    }
  }

  const newMessage = {
    type: "news",
    describe: describe,
  };

  gameRoomMessage(newMessage, roomId, "news");
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
