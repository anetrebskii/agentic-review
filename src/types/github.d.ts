import { Octokit } from '@octokit/rest';
import { RestEndpointMethods } from '@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types';
import { Api } from '@octokit/plugin-rest-endpoint-methods/dist-types/types';
import { PaginateInterface } from '@octokit/plugin-paginate-rest';

declare module '@actions/github' {
  export function getOctokit(
    token: string,
    options?: any
  ): Octokit & RestEndpointMethods & Api & { paginate: PaginateInterface };
} 