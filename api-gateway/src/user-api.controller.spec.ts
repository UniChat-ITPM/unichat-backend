import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { UserApiController } from './user-api.controller';
import { ApiService } from './api.service';

describe('UserApiController – PUT /api/user/:id routes (e2e)', () => {
  let app: INestApplication;
  let apiService: jest.Mocked<ApiService>;

  beforeAll(async () => {
    apiService = {
      forwardOtpRequest: jest.fn(),
      forwardOtpVerify: jest.fn(),
      forwardCompleteProfile: jest.fn(),
      forwardUpdateUser: jest.fn(),
      forwardDeactivateUser: jest.fn(),
      forwardFindUserByPhone: jest.fn(),
      forwardCreateUser: jest.fn(),
    } as unknown as jest.Mocked<ApiService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserApiController],
      providers: [{ provide: ApiService, useValue: apiService }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should forward valid user update payload and return 200', async () => {
    const payload = {
      success: true,
      user: {
        id: 'u100',
        displayName: 'new_name',
        username: 'new_name',
        email: 'new@example.com',
      },
    };
    apiService.forwardUpdateUser.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .put('/api/user/u100')
      .send({
        displayName: 'new_name',
        username: 'new_name',
        email: 'new@example.com',
      })
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(apiService.forwardUpdateUser).toHaveBeenCalledWith('u100', {
      displayName: 'new_name',
      username: 'new_name',
      email: 'new@example.com',
    });
  });

  it('should return 400 for invalid email in update payload', async () => {
    await request(app.getHttpServer())
      .put('/api/user/u100')
      .send({ email: 'bad-email' })
      .expect(400);
  });

  it('should forward deactivate request and return 200', async () => {
    const payload = {
      success: true,
      user: { id: 'u100', accountStatus: false },
    };
    apiService.forwardDeactivateUser.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .put('/api/user/u100/deactivate')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(apiService.forwardDeactivateUser).toHaveBeenCalledWith('u100');
  });
});
