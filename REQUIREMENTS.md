Description:

This application will mimic the statuscake functionality where a user can define tests that will be performed against a given url. The user should be able to onboard tests that perform GET, POST to a given endpoint, match an expected output literally and establish a frequency to perform the test.


Tech Requirements:
- Application should have a frontend and backend
- Application should be testeable in docker compose first
- It should have an sql database
- Frontend should be done in React
- Backend should be python with Fastapi and Swagger public
- Create a make file with the following options
  - make run : start the docker app
  - make build : destroy current app and rebuild docker
  - make test : start loading sample data

  

Functional Requirements:
- It should be protected with login with a default user and a random password generated on each deployment
- There should be Application owners, so a user can login and create an application and tests. 
- The default users can see the rest of applications but not modify them
- It should show charts of historical data where correct values are green and absent request or incorrect http codes are shown as red
- It should aggregate tests in Applications
- An application should have a url, a creation date, a healty score based on http code aggregated from each test
- It should show a list of Tests
- A test should have a http endpoint, http operation, expected result, payload if it is a post
- The application should have a landing page with a chart comparing all applications
- It should create a local script to load sample data to test the app loading it directly to the SQL in streaming
- Tests should be checked every 30 seconds, if the result is the correct nothing should be stored so only bad results are stored. The chart should assume that if not bad result all is correct
- Historical charts should show health status with error codes, Admin and owners should be able to filter the chart by time window or error code
- Healthy score should be represented like:
   - The more the app is running without issues the healthier, and every error should be discounted from the health but will become less important if there is a bigger healthy period
- Landing page should have a timeline chart not bars with the evolution of the different applications.
- Landing should be more structured and only have global view
- Application page need to be created showing details for an application and that is the place to create tests
- New application should be a pop up for the current user not an static part of the landing
- Chart should show red bars or points in errors
- Application view should show a table with the latest tests and the result including timestamp
- Add new test should also be a popup as the new application, and should include a legend for each field to understand what it means
- The ui should also edit or delete tests in case they are wrongly setup
- The application should not show healthy for datapoints before the creationtime
- minimum check can be 15 seconds
