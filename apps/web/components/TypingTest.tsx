'use client';

import { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type CharState = 'untyped' | 'correct' | 'incorrect';

const initialText = 'the quick brown fox jumps over the lazy dog';
const TEST_DURATION = 30;

export default function TypingTest() {
  const [text, setText] = useState(initialText);
  const [cursor, setCursor] = useState(0);
  const [typedCount, setTypedCount] = useState(0);
  const [charStates, setCharStates] = useState<CharState[]>(
    () => Array(initialText.length).fill('untyped')
  );

  const [timeLeft, setTimeLeft] = useState(TEST_DURATION);
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [finalElapsedTime, setFinalElapsedTime] = useState<number | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [opponentProgress, setOpponentProgress] = useState<{
    userId: string;
    cursor: number;
    wpm: number;
    accuracy: number;
  } | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [roomId, setRoomId] = useState('');
  const [hasJoinedRoom, setHasJoinedRoom] = useState(false);

  const resetLocalState = () => {
    setCursor(0);
    setTypedCount(0);
    setCharStates(Array(text.length).fill('untyped'));
    setTimeLeft(TEST_DURATION);
    setIsRunning(false);
    setIsFinished(false);
    setFinalElapsedTime(null);
    setOpponentProgress(null);
  };

  const resetTest = () => {
    resetLocalState();

    if (socket && roomId) {
      socket.emit('player_reset', { roomId });
    }
  };

  useEffect(() => {
    setText(initialText);
  }, []);

  useEffect(() => {
    resetTest();
  }, [text]);

  // Socket test connection
  useEffect(() => {
    const s = io('http://localhost:3001');

    s.on('connect', () => {
      console.log('Connected:', s.id);
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);


  useEffect(() =>{
    if(!socket)return;

    const handleProgressUpdate = (data : {
      userId: string,
      cursor: number,
      wpm: number,
      accuracy: number
    }) =>{
      console.log("Other user: ", data);
      setOpponentProgress(data);
    };

    socket.on("progress_update", handleProgressUpdate);

    return () =>{
      socket.off('progress_update', handleProgressUpdate);
    };
  }, [socket])

  useEffect(() => {
    if (!socket) return;

    const handlePlayerReset = (data: {
      userId: string;
      cursor: number;
      wpm: number;
      accuracy: number;
    }) => {
      setOpponentProgress(data);
    };

    socket.on('player_reset', handlePlayerReset);

    return () => {
      socket.off('player_reset', handlePlayerReset);
    };
  }, [socket]);

  useEffect(() => {
    if (!isRunning || isFinished) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          const elapsed = TEST_DURATION;
          setFinalElapsedTime(elapsed);
          setIsRunning(false);
          setIsFinished(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isRunning, isFinished]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      // 🚨 Ignore input fields
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      if (isFinished) return;

      if (!isRunning && e.key.length === 1) {
        setIsRunning(true);
      }

      if (e.key === 'Backspace') {
        e.preventDefault();

        if (cursor === 0) return;

        setCharStates((prev) => {
          const next = [...prev];
          next[cursor - 1] = 'untyped';
          return next;
        });

        setCursor((prev) => prev - 1);
        setTypedCount((prev) => Math.max(0, prev - 1));
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
      }

      if (e.key.length !== 1) return;
      if (cursor >= text.length) return;

      const expectedChar = text[cursor];
      const typedChar = e.key;
      const isCorrect = typedChar === expectedChar;

      setCharStates((prev) => {
        const next = [...prev];
        next[cursor] = isCorrect ? 'correct' : 'incorrect';
        return next;
      });

      const nextCursor = cursor + 1;
      setCursor(nextCursor);
      setTypedCount((prev) => prev + 1);

      if(socket)
        {socket.emit("progress_update", {
        roomId,
        cursor: nextCursor,
        wpm,
        accuracy
      })}

      if (nextCursor >= text.length) {
        const elapsed = TEST_DURATION - timeLeft;
        setFinalElapsedTime(elapsed);
        setIsRunning(false);
        setIsFinished(true);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [cursor, text, isRunning, isFinished, timeLeft, socket, roomId]);

  const correctCount = useMemo(
    () => charStates.filter((state) => state === 'correct').length,
    [charStates]
  );

  const incorrectCount = useMemo(
    () => charStates.filter((state) => state === 'incorrect').length,
    [charStates]
  );

  const accuracy = useMemo(() => {
    if (typedCount === 0) return 100;
    return Math.round((correctCount / typedCount) * 100);
  }, [correctCount, typedCount]);

  const elapsedTime = finalElapsedTime ?? (TEST_DURATION - timeLeft);

  const wpm = useMemo(() => {
    if (elapsedTime <= 0) return 0;
    const minutes = elapsedTime / 60;
    return Math.round((correctCount / 5) / minutes);
  }, [correctCount, elapsedTime]);

  const getCharacterClass = (index: number) => {
    const state = charStates[index];
    if (state === 'correct') return 'text-green-400';
    if (state === 'incorrect') return 'text-red-400';
    return 'text-neutral-500';
  };

  const opponentPercent = opponentProgress
  ? Math.min((opponentProgress.cursor / text.length) * 100, 100)
  : 0;

  const generateRoomCode = () => {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
  };

const handleCreateRoom = () => {
  if (!socket) return;

  const newRoomId = generateRoomCode();
  resetLocalState();

  socket.emit('join_room', newRoomId);

  setRoomId(newRoomId);
  setRoomInput(newRoomId);
  setHasJoinedRoom(true);
};

const handleJoinRoom = () => {
  if (!socket || !roomInput.trim()) return;

  const trimmedRoom = roomInput.trim().toUpperCase();
  resetLocalState();

  socket.emit('join_room', trimmedRoom);

  setRoomId(trimmedRoom);
  setHasJoinedRoom(true);
};

  if (!hasJoinedRoom) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-900 px-6 text-white">
      <div className="w-full max-w-md rounded-xl bg-neutral-800 p-6 shadow-lg">
        <h1 className="mb-6 text-2xl font-semibold">Typio</h1>

        <div className="mb-4">
          <label className="mb-2 block text-sm text-neutral-300">Player Name</label>
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Enter your name"
            className="w-full rounded-md bg-neutral-700 px-3 py-2 text-white outline-none"
          />
        </div>

        <div className="mb-4">
          <label className="mb-2 block text-sm text-neutral-300">Room Code</label>
          <input
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
            placeholder="Enter room code"
            className="w-full rounded-md bg-neutral-700 px-3 py-2 text-white outline-none"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleCreateRoom}
            className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-500"
          >
            Create Room
          </button>

          <button
            onClick={handleJoinRoom}
            className="flex-1 rounded-md bg-neutral-700 px-4 py-2 text-white hover:bg-neutral-600"
          >
            Join Room
          </button>
        </div>
      </div>
    </main>
  );
}

  return (
    
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 bg-neutral-900 px-6 text-white">
      <div className="text-sm text-neutral-400">
          Room: <span className="text-white">{roomId}</span>
          {playerName && (
            <>
              {' '}| Player: <span className="text-white">{playerName}</span>
            </>
          )}
      </div>
      <div className="flex gap-6 text-sm text-neutral-300">
        <div>Time: <span className="text-white">{timeLeft}s</span></div>
        <div>WPM: <span className="text-white">{wpm}</span></div>
        <div>Accuracy: <span className="text-white">{accuracy}%</span></div>
        <div>Correct: <span className="text-white">{correctCount}</span></div>
        <div>Incorrect: <span className="text-white">{incorrectCount}</span></div>
      </div>
      
      {opponentProgress && (
        <div className="w-full max-w-2xl rounded-md bg-neutral-800 p-4">
          <div className="mb-2 flex justify-between text-sm text-neutral-300">
            <span>Opponent</span>
            <span>
              WPM: <span className="text-white">{opponentProgress.wpm}</span> | Accuracy:{' '}
              <span className="text-white">{opponentProgress.accuracy}%</span>
            </span>
          </div>

          <div className="h-3 w-full overflow-hidden rounded bg-neutral-700">
            <div
              className="h-full bg-blue-500 transition-all duration-100"
              style={{ width: `${opponentPercent}%` }}
            />
          </div>

          <div className="mt-2 text-xs text-neutral-400">
            Cursor: {opponentProgress.cursor} / {text.length}
          </div>
        </div>
      )}

      <div className="max-w-2xl text-2xl leading-relaxed">
        {text.split('').map((char, index) => {
          const isCaret = index === cursor && !isFinished;
          return (
            <span
              key={index}
              className={`${getCharacterClass(index)} ${
                isCaret ? 'underline decoration-white underline-offset-4 text-white' : ''
              }`}
            >
              {char}
            </span>
          );
        })}
      </div>

      <button
        onClick={resetTest}
        className="rounded-md bg-neutral-800 px-4 py-2 text-sm text-white hover:bg-neutral-700"
      >
        Reset
      </button>

      {isFinished && (
        <div className="text-sm text-neutral-300">
          Test finished. Final WPM: <span className="text-white">{wpm}</span>, Accuracy:{' '}
          <span className="text-white">{accuracy}%</span>
        </div>
      )}
    </main>
  );
}