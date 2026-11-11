import database from './data-source.js';
import { Room } from '../rooms/room.entity.js';

await database.initialize();
try {
  await database.getRepository(Room).createQueryBuilder()
    .insert()
    .values([
      {
        id: '27d564af-8e06-4192-8b3d-1fbce7d19642',
        name: 'Маяк',
        location: '2 этаж',
        capacity: 6,
        description: 'Для рабочих встреч и видеозвонков.',
        equipment: ['Телевизор', 'Видеосвязь'],
      },
      {
        id: 'e59e1019-30b3-4764-85bc-c4fdd8744a7f',
        name: 'Горизонт',
        location: '3 этаж',
        capacity: 12,
        description: 'Переговорная для презентаций и встреч команды.',
        equipment: ['Проектор', 'Доска', 'Видеосвязь'],
      },
      {
        id: '41092120-f570-4750-8923-4a0b420b2810',
        name: 'Терраса',
        location: '4 этаж',
        capacity: 4,
        description: 'Небольшая комната для обсуждений.',
        equipment: ['Доска'],
      },
    ])
    .orIgnore()
    .execute();
} finally {
  await database.destroy();
}
