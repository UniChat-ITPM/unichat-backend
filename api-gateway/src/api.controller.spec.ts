import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';

describe('ApiController – POST /api/auth/register/complete (e2e)', () => {
  let app: INestApplication;
  let apiService: jest.Mocked<ApiService>;

  beforeAll(async () => {
    apiService = {
      forwardOtpRequest: jest.fn(),
      forwardOtpVerify: jest.fn(),
      forwardCompleteProfile: jest.fn(),
    } as unknown as jest.Mocked<ApiService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiController],
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

  it('should forward a valid JSON request to user-service and return 200', async () => {
    const userPayload = {
      success: true,
      isNewUser: false,
      user: {
        id: 'u1',
        phoneNumber: '+94771234567',
        displayName: 'test_user',
        username: 'test_user',
        email: 'test@example.com',
        avatarUrl: null,
        profileCompleted: true,
        status: 'ACTIVE',
      },
    };
    apiService.forwardCompleteProfile.mockResolvedValue(userPayload);

    const res = await request(app.getHttpServer())
      .post('/api/auth/register/complete')
      .send({
        phoneNumber: '+94771234567',
        username: 'test_user',
        email: 'test@example.com',
      })
      .expect(200);

    expect(res.body).toEqual(userPayload);
    expect(apiService.forwardCompleteProfile).toHaveBeenCalledWith({
      phoneNumber: '+94771234567',
      username: 'test_user',
      email: 'test@example.com',
      profilePhoto: undefined,
    });
  });

  it('should return 400 when required fields are missing', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register/complete')
      .send({ phoneNumber: '+94771234567' })
      .expect(400);
  });

  it('should return 400 for invalid phone format', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register/complete')
      .send({
        phoneNumber: '12345',
        username: 'test_user',
        email: 'test@example.com',
      })
      .expect(400);
  });

  it('should return 400 for invalid email format', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register/complete')
      .send({
        phoneNumber: '+94771234567',
        username: 'test_user',
        email: 'not-an-email',
      })
      .expect(400);
  });

  it('should return 400 for username with invalid characters', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register/complete')
      .send({
        phoneNumber: '+94771234567',
        username: 'bad user!',
        email: 'test@example.com',
      })
      .expect(400);
  });

  it('should return 400 for username shorter than 3 characters', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register/complete')
      .send({
        phoneNumber: '+94771234567',
        username: 'ab',
        email: 'test@example.com',
      })
      .expect(400);
  });
});
