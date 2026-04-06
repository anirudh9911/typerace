'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type CharState = 'untyped' | 'correct' | 'incorrect';

const initialText = 'the quick brown fox jumps over the lazy dog';

export default function TypingTest() {
  const [text, setText] = useState(initialText);
  const [cursor, setCursor] = useState(0);
  const [typedCount, setTypedCount] = useState(0);
  const [charStates, setCharStates] = useState<CharState[]>(
    () => Array(initialText.length).fill('untyped')
  );

  const [timeLeft, setTimeLeft] = useState(30);
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [finalElapsedTime, setFinalElapsedTime] = useState<number | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [opponentProgress, setOpponentProgress] = useState<Record<string, {
    userId: string;
    cursor: number;
    wpm: number;
    accuracy: number;
  }>>({});
  const [playerName, setPlayerName] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [roomId, setRoomId] = useState('');
  const [gamePhase, setGamePhase] = useState<'setup' | 'lobby' | 'countdown' | 'racing'>('setup');
  const [isHost, setIsHost] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [testDuration, setTestDuration] = useState(30);
  const [duration, setDuration] = useState(30);
  const [roomPlayers, setRoomPlayers] = useState<{ id: string; name: string }[]>([]);
  const [myPlacement, setMyPlacement] = useState<number | null>(null);
  const [raceResults, setRaceResults] = useState<{ name: string; placement: number; wpm: number; accuracy: number }[] | null>(null);
  const [leaderboard, setLeaderboard] = useState<{ player_name: string; best_wpm: number; rank: number }[]>([]);
  const [joinError, setJoinError] = useState<string | null>(null);

  const resetLocalState = () => {
    setCursor(0);
    setTypedCount(0);
    setCharStates(Array(text.length).fill('untyped'));
    setTimeLeft(testDuration);
    setIsRunning(false);
    setIsFinished(false);
    setFinalElapsedTime(null);
    setOpponentProgress({});
  };

  const resetTest = () => {
    setCursor(0);
    setTypedCount(0);
    setCharStates(Array(text.length).fill('untyped'));

    if (socket && roomId) {
      socket.emit('player_reset', { roomId });
    }
  };

  useEffect(() => {
    setText(initialText);
  }, []);


  // Socket test connection
  useEffect(() => {
    const s = io(process.env.NEXT_PUBLIC_SERVER_URL!);

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
      setOpponentProgress((prev) => ({ ...prev, [data.userId]: data }));
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
      setOpponentProgress((prev) => ({ ...prev, [data.userId]: data }));
    };

    socket.on('player_reset', handlePlayerReset);

    return () => {
      socket.off('player_reset', handlePlayerReset);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    const handleRoomPlayers = (players: { id: string; name: string }[]) => {
      setRoomPlayers(players);
      setGamePhase((prev) => prev === 'setup' ? 'lobby' : prev);
    };
    socket.on('room_players', handleRoomPlayers);
    return () => {
      socket.off('room_players', handleRoomPlayers);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    const handleRaceConfig = ({ duration, text, timeLeft }: { duration: number; text: string; timeLeft?: number }) => {
      setTestDuration(duration);
      setTimeLeft(timeLeft ?? duration);
      setText(text);
      setCharStates(Array(text.length).fill('untyped'));
    };
    const handleCountdownTick = (count: number) => {
      setGamePhase('countdown');
      setCountdown(count);
    };
    const handleRaceStart = () => {
      setMyPlacement(null);
      setRaceResults(null);
      setGamePhase('racing');
      setIsRunning(true);
    };
    const handlePlayerFinished = (data: { name: string; placement: number; wpm: number; accuracy: number }) => {
      if (data.name === playerName) setMyPlacement(data.placement);
    };
    const handleRaceResults = (results: { name: string; placement: number; wpm: number; accuracy: number }[]) => {
      setRaceResults(results);
      fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/leaderboard`)
        .then((r) => r.json())
        .then(setLeaderboard)
        .catch(console.error);
    };
    const handlePlayAgain = () => {
      resetLocalState();
      setRaceResults(null);
      setMyPlacement(null);
      setGamePhase('lobby');
    };
    const handleLeaderboardUpdate = (data: { player_name: string; best_wpm: number; rank: number }[]) => {
      setLeaderboard(data);
    };
    const handleJoinError = ({ message }: { message: string }) => {
      setJoinError(message);
    };
    socket.on('race_config', handleRaceConfig);
    socket.on('countdown_tick', handleCountdownTick);
    socket.on('race_start', handleRaceStart);
    socket.on('player_finished', handlePlayerFinished);
    socket.on('race_results', handleRaceResults);
    socket.on('play_again', handlePlayAgain);
    socket.on('leaderboard_update', handleLeaderboardUpdate);
    socket.on('join_error', handleJoinError);
    return () => {
      socket.off('race_config', handleRaceConfig);
      socket.off('countdown_tick', handleCountdownTick);
      socket.off('race_start', handleRaceStart);
      socket.off('player_finished', handlePlayerFinished);
      socket.off('race_results', handleRaceResults);
      socket.off('play_again', handlePlayAgain);
      socket.off('leaderboard_update', handleLeaderboardUpdate);
      socket.off('join_error', handleJoinError);
    };
  }, [socket, playerName]);

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

  const elapsedTime = finalElapsedTime ?? (testDuration - timeLeft);

  const wpm = useMemo(() => {
    if (elapsedTime <= 0) return 0;
    const minutes = elapsedTime / 60;
    return Math.round((correctCount / 5) / minutes);
  }, [correctCount, elapsedTime]);

  const wpmRef = useRef(wpm);
  const accuracyRef = useRef(accuracy);
  wpmRef.current = wpm;
  accuracyRef.current = accuracy;

  useEffect(() => {
    if (!isRunning || isFinished) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          const elapsed = testDuration;
          setFinalElapsedTime(elapsed);
          setIsRunning(false);
          setIsFinished(true);
          if (socket && roomId) {
            socket.emit('race_finish', { roomId, wpm: wpmRef.current, accuracy: accuracyRef.current });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isRunning, isFinished, socket, roomId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      // Ignore input fields
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      if (isFinished || gamePhase !== 'racing') return;

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

    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [cursor, text, isRunning, isFinished, timeLeft, socket, roomId, gamePhase]);

  const getCharacterClass = (index: number) => {
    const state = charStates[index];
    if (state === 'correct') return 'text-green-400';
    if (state === 'incorrect') return 'text-red-400';
    return 'text-neutral-500';
  };


  const generateRoomCode = () => {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
  };

const handleCreateRoom = () => {
  if (!socket) return;

  const newRoomId = generateRoomCode();
  resetLocalState();

  socket.emit('join_room', { roomId: newRoomId, playerName });

  setRoomId(newRoomId);
  setRoomInput(newRoomId);
  setIsHost(true);
};

const handleJoinRoom = () => {
  if (!socket || !roomInput.trim()) return;

  const trimmedRoom = roomInput.trim().toUpperCase();
  resetLocalState();

  socket.emit('join_room', { roomId: trimmedRoom, playerName });

  setRoomId(trimmedRoom);
};

  if (gamePhase === 'setup') {
  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-900 px-6 text-white">
      <div className="w-full max-w-md rounded-xl bg-neutral-800 p-6 shadow-lg">
        <h1 className="mb-6 text-2xl font-semibold">Typio</h1>

        <div className="mb-4">
          <label className="mb-2 block text-sm text-neutral-300">Player Name</label>
          <input
            value={playerName}
            onChange={(e) => { setPlayerName(e.target.value); setJoinError(null); }}
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

        {joinError && <p className="text-red-400 text-sm mb-4">{joinError}</p>}

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

  if (gamePhase === 'lobby') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-900 px-6 text-white">
        <div className="w-full max-w-md rounded-xl bg-neutral-800 p-6 shadow-lg">
          <div className="mb-1 text-xs text-neutral-500">Room: {roomId}</div>
          <h2 className="mb-6 text-xl font-semibold">Waiting for players</h2>

          <div className="mb-6 flex flex-col gap-2">
            {roomPlayers.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <span className={p.id === socket?.id ? 'text-white font-semibold' : 'text-neutral-300'}>
                  {p.name}
                </span>
                {p.id === socket?.id && (
                  <span className="text-xs text-neutral-500">(you)</span>
                )}
              </div>
            ))}
          </div>

          {isHost ? (
            <>
              <div className="mb-4 flex items-center gap-2 text-sm text-neutral-400">
                <span>Duration:</span>
                {[30, 60].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={`rounded-md px-3 py-1 ${duration === d ? 'bg-blue-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'}`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
              <button
                onClick={() => socket?.emit('start_race', { roomId, duration })}
                className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-500"
              >
                Start Race
              </button>
            </>
          ) : (
            <p className="text-sm text-neutral-400">Waiting for host to start...</p>
          )}
        </div>
      </main>
    );
  }

  if (gamePhase === 'countdown') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-900 text-white">
        <div className="text-8xl font-bold">{countdown}</div>
      </main>
    );
  }

  if (raceResults) {
    const placementLabel = (n: number) => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-900 px-6 text-white">
        <div className="w-full max-w-md rounded-xl bg-neutral-800 p-6 shadow-lg">
          <h2 className="mb-6 text-xl font-semibold">Race Results</h2>
          <div className="flex flex-col gap-3">
            {raceResults.map((r) => {
              const isMe = r.name === playerName;
              const isWinner = r.placement === 1;
              return (
                <div
                  key={r.placement}
                  className={`flex items-center justify-between rounded-md px-4 py-3 text-sm ${
                    isWinner ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-neutral-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`font-bold ${isWinner ? 'text-yellow-400' : 'text-neutral-400'}`}>
                      {placementLabel(r.placement)}
                    </span>
                    <span className={isMe ? 'text-white font-semibold' : 'text-neutral-300'}>
                      {r.name}{isMe ? ' (you)' : ''}
                    </span>
                  </div>
                  <span className="text-neutral-400">
                    <span className="text-white">{r.wpm}</span> WPM · <span className="text-white">{r.accuracy}%</span> Accuracy
                  </span>
                </div>
              );
            })}
          </div>
          {isHost && (
            <button
              onClick={() => {
                resetLocalState();
                setRaceResults(null);
                setMyPlacement(null);
                setLeaderboard([]);
                setGamePhase('lobby');
                socket?.emit('play_again', { roomId });
              }}
              className="mt-6 w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-500"
            >
              Play Again
            </button>
          )}

          {leaderboard.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-semibold text-neutral-400 uppercase tracking-wider">Leaderboard</h3>
              <div className="flex flex-col gap-2">
                {leaderboard.map((entry, i) => (
                  <div key={entry.player_name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-neutral-500 w-5">{i + 1}.</span>
                      <span className={entry.player_name === playerName ? 'text-white font-semibold' : 'text-neutral-300'}>
                        {entry.player_name}
                      </span>
                    </div>
                    <span className="text-neutral-400">
                      <span className="text-white">{entry.best_wpm}</span> WPM
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
      {roomPlayers.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <span>Players in room:</span>
          <span className="text-neutral-600">|</span>
          {roomPlayers.map((p, i) => (
            <span key={p.id} className={p.id === socket?.id ? 'text-white font-semibold' : ''}>
              {p.name}{i < roomPlayers.length - 1 ? ' ·' : ''}
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-6 text-sm text-neutral-300">
        <div>Time: <span className="text-white">{timeLeft}s</span></div>
        <div>WPM: <span className="text-white">{wpm}</span></div>
        <div>Accuracy: <span className="text-white">{accuracy}%</span></div>
        <div>Correct: <span className="text-white">{correctCount}</span></div>
        <div>Incorrect: <span className="text-white">{incorrectCount}</span></div>
      </div>
      
      {(() => {
        const myId = socket?.id ?? '';
        const myEntry = { userId: myId, cursor, wpm, accuracy };
        const allPlayers = [
          myEntry,
          ...Object.values(opponentProgress),
        ].sort((a, b) => b.cursor - a.cursor);

        return (
          <div className="w-full max-w-2xl flex flex-col gap-2">
            {allPlayers.map((p, rank) => {
              const isMe = p.userId === myId;
              const name = isMe ? playerName || 'You' : (roomPlayers.find((r) => r.id === p.userId)?.name ?? 'Opponent');
              const percent = Math.min((p.cursor / text.length) * 100, 100);
              return (
                <div
                  key={p.userId}
                  className={`rounded-lg p-3 transition-all ${
                    isMe
                      ? 'bg-blue-600/20 border border-blue-500/40'
                      : 'bg-neutral-800/80'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold w-5 text-center ${rank === 0 ? 'text-yellow-400' : 'text-neutral-500'}`}>
                        {rank + 1}
                      </span>
                      <span className={isMe ? 'text-blue-300 font-semibold' : 'text-neutral-300'}>
                        {name}{isMe ? ' (you)' : ''}
                      </span>
                    </div>
                    <div className="flex gap-3 text-xs text-neutral-400">
                      <span><span className={isMe ? 'text-blue-200' : 'text-white'}>{p.wpm}</span> WPM</span>
                      <span><span className={isMe ? 'text-blue-200' : 'text-white'}>{p.accuracy}%</span> Acc</span>
                    </div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-700">
                    <div
                      className={`h-full rounded-full transition-all duration-150 ${isMe ? 'bg-blue-400' : 'bg-neutral-400'}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

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